#!/usr/bin/env swift

import Foundation
import Security
import Darwin

enum MigrationError: Error, CustomStringConvertible {
    case usage
    case unreadableSource
    case invalidJSON
    case emptySecret
    case keychain(OSStatus)

    var description: String {
        switch self {
        case .usage:
            return "Usage: fcos-keychain <set account service source-file raw|json-token|prompt-set account service|get account service|exists account service>"
        case .unreadableSource:
            return "The credential source could not be read."
        case .invalidJSON:
            return "The credential JSON does not contain a token."
        case .emptySecret:
            return "The credential is empty."
        case .keychain(let code):
            return "macOS Keychain rejected the credential update (OSStatus \(code))."
        }
    }
}

func secretData(sourcePath: String, format: String) throws -> Data {
    guard let source = FileManager.default.contents(atPath: sourcePath) else {
        throw MigrationError.unreadableSource
    }
    let secret: String
    if format == "json-token" {
        guard
            let object = try? JSONSerialization.jsonObject(with: source) as? [String: Any],
            let token = object["token"] as? String
        else {
            throw MigrationError.invalidJSON
        }
        secret = token
    } else if format == "raw" {
        secret = String(decoding: source, as: UTF8.self)
    } else {
        throw MigrationError.usage
    }
    let trimmed = secret.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { throw MigrationError.emptySecret }
    return Data(trimmed.utf8)
}

func save(account: String, service: String, value: Data) throws {
    let lookup: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrAccount as String: account,
        kSecAttrService as String: service,
    ]
    let update: [String: Any] = [
        kSecValueData as String: value,
        kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let updateStatus = SecItemUpdate(lookup as CFDictionary, update as CFDictionary)
    if updateStatus == errSecSuccess { return }
    guard updateStatus == errSecItemNotFound else { throw MigrationError.keychain(updateStatus) }

    var add = lookup
    add[kSecValueData as String] = value
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let addStatus = SecItemAdd(add as CFDictionary, nil)
    guard addStatus == errSecSuccess else { throw MigrationError.keychain(addStatus) }
}

func promptedSecret() throws -> Data {
    guard let pointer = getpass("Credential: ") else { throw MigrationError.emptySecret }
    let secret = String(cString: pointer).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !secret.isEmpty else { throw MigrationError.emptySecret }
    return Data(secret.utf8)
}

func read(account: String, service: String) throws -> Data {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrAccount as String: account,
        kSecAttrService as String: service,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    let readStatus = SecItemCopyMatching(query as CFDictionary, &result)
    guard readStatus == errSecSuccess, let value = result as? Data else {
        throw MigrationError.keychain(readStatus)
    }
    return value
}

do {
    let arguments = CommandLine.arguments
    guard arguments.count >= 4 else { throw MigrationError.usage }
    switch arguments[1] {
    case "set":
        guard arguments.count == 6 else { throw MigrationError.usage }
        let value = try secretData(sourcePath: arguments[4], format: arguments[5])
        try save(account: arguments[2], service: arguments[3], value: value)
        print("Credential stored in the dedicated macOS Keychain item (\(value.count) bytes).")
    case "get":
        guard arguments.count == 4 else { throw MigrationError.usage }
        FileHandle.standardOutput.write(try read(account: arguments[2], service: arguments[3]))
    case "prompt-set":
        guard arguments.count == 4 else { throw MigrationError.usage }
        let value = try promptedSecret()
        try save(account: arguments[2], service: arguments[3], value: value)
        print("Credential stored in the dedicated macOS Keychain item (\(value.count) bytes).")
    case "exists":
        guard arguments.count == 4 else { throw MigrationError.usage }
        let value = try read(account: arguments[2], service: arguments[3])
        print(value.isEmpty ? "missing" : "available")
        if value.isEmpty { exit(2) }
    default:
        throw MigrationError.usage
    }
} catch {
    fputs("\(error)\n", stderr)
    exit(1)
}
