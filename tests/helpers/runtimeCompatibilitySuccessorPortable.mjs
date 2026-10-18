import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const FIXTURE_ROOT = join(SOURCE_ROOT, 'tests/fixtures/runtime-compatibility-successor-integration');
export const MANIFEST_HASH = 'b4174f857542dce164c3e70cb68f59f0062a42b0b9378975bb7e20d2342ae9f2';
export const PACK_HASH = 'edb0c7a0d0ac7f45dba5fcfc8f6d98cbbf9667f01713a5d7f7764dc7e7380628';
const BINDINGS_HASH = '3326b022199c91119669c34c1bb8f7158b8acbff59100f9e4b4da3c9c5c2861b';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function regularFile(root, path) {
  const parts = path.split('/');
  assert.ok(!path.startsWith('/') && !/[\\\x00-\x1f\x7f]/.test(path)
    && parts.every(part => part && !['.', '..'].includes(part)), 'Exact relative source path required.');
  for (let index = 1; index <= parts.length; index++) {
    const info = fs.lstatSync(join(root, ...parts.slice(0, index)));
    assert.ok(!info.isSymbolicLink() && (index === parts.length ? info.isFile() : info.isDirectory()), `Regular source path required: ${path}`);
  }
  return fs.readFileSync(join(root, path));
}
const historicalManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v2.json');
assert.equal(hash(historicalManifestBytes), '91e8ba3fdacb7cd03a2bed574248920a2d6416aa043c4e5daafd7a5f5ac53257', 'Historical public manifest differs.');
const historicalManifest = JSON.parse(historicalManifestBytes);
const thirdManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v3.json');
assert.equal(hash(thirdManifestBytes), '7335cb2d1482974c9dda3ee5552bcfc07befc5422329f0c0b2bc246635c4a71a', 'Third public manifest differs.');
const historicalBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v2.json');
assert.equal(hash(historicalBindingBytes), 'e83c88a3b42d2252c3462f9ed4ce7d5a3c7d6b0d6bf6d8879ec1502d5054e126', 'Historical source bindings differ.');
const previousBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v3.json');
assert.equal(hash(previousBindingBytes), 'f380529fc56450a521ac2d83dc0d8b4de55b05a40f7f1e7835c47db7662fb3cb', 'Previous source bindings differ.');
assert.equal(JSON.parse(previousBindingBytes).previousSourceBindingsSha256, hash(historicalBindingBytes), 'Historical binding chain differs.');
const fourthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v4.json');
assert.equal(hash(fourthBindingBytes), 'd425a033ca56ca867f8b36e5d0d68b1e313280c2d15933b2b4d6b4549695c992', 'Fourth source bindings differ.');
assert.equal(JSON.parse(fourthBindingBytes).previousSourceBindingsSha256, hash(previousBindingBytes), 'Fourth binding history differs.');
const fifthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v5.json');
assert.equal(hash(fifthBindingBytes), 'fcbd9735f0813d1e5fcb94cc69786b2363e6013d8ccf6fcf0cd62465acf41b63', 'Fifth source bindings differ.');
assert.equal(JSON.parse(fifthBindingBytes).previousSourceBindingsSha256, hash(fourthBindingBytes), 'Fifth binding history differs.');
const sixthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v6.json');
assert.equal(hash(sixthBindingBytes), '9f12806a65cd820a0752974b01ddb003cc6380dd4524039e1c1e8d7b78798c97', 'Sixth source bindings differ.');
assert.equal(JSON.parse(sixthBindingBytes).previousSourceBindingsSha256, hash(fifthBindingBytes), 'Sixth binding history differs.');
const seventhBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v7.json');
assert.equal(hash(seventhBindingBytes), '45544b75bf83a1ebfb8f4a636bbf164cae73b63429d0f8e5f2d388be6fd4e608', 'Seventh source bindings differ.');
assert.equal(JSON.parse(seventhBindingBytes).previousSourceBindingsSha256, hash(sixthBindingBytes), 'Seventh binding history differs.');
const eighthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v8.json');
assert.equal(hash(eighthBindingBytes), '137869368ccead8ea4569cb50a58cbebed58a35f25c134017072022bb6424976', 'Eighth source bindings differ.');
assert.equal(JSON.parse(eighthBindingBytes).previousSourceBindingsSha256, hash(seventhBindingBytes));
const ninthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v9.json');
assert.equal(hash(ninthBindingBytes), '1f60f8a711a097e88c91e18a92064620c89bbd3681b02da523cdeeb1d548db35', 'Ninth source bindings differ.');
assert.equal(JSON.parse(ninthBindingBytes).previousSourceBindingsSha256, hash(eighthBindingBytes));
const tenthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v10.json');
assert.equal(hash(tenthBindingBytes), 'b9ca879a36b4952a95e18ceff91619ed9f650323aeb1532514f0ff6d6e8691cc');
assert.equal(JSON.parse(tenthBindingBytes).previousSourceBindingsSha256, hash(ninthBindingBytes));
const eleventhBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v11.json');
assert.equal(hash(eleventhBindingBytes), 'f6d56b07df359ec7cf457e6bfa113d2becf19066f83425f4448b6cbef61766ef');
assert.equal(JSON.parse(eleventhBindingBytes).previousSourceBindingsSha256, hash(tenthBindingBytes));
const twelfthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v12.json');
assert.equal(hash(twelfthBindingBytes), '1eb2b49ca8b8b59902cf5a0b757177c1414875e908591a36dda2ff19e4f86738');
assert.equal(JSON.parse(twelfthBindingBytes).previousSourceBindingsSha256, hash(eleventhBindingBytes));
const thirteenthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v13.json');
assert.equal(hash(thirteenthBindingBytes), 'bb0f129e22b7fb97ba000c58dbabbb9823171d59ba060a0774d13fcf3c3854fa');
assert.equal(JSON.parse(thirteenthBindingBytes).previousSourceBindingsSha256, hash(twelfthBindingBytes));
const fourteenthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v14.json');
assert.equal(hash(fourteenthBindingBytes), 'd36210e9a0f33fdee76fc8fea7b2ae740b5a576e83b9b553d74ad0b6a8d3640d');
assert.equal(JSON.parse(fourteenthBindingBytes).previousSourceBindingsSha256, hash(thirteenthBindingBytes));
const fifteenthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v15.json');
assert.equal(hash(fifteenthBindingBytes), '870c463095272ee2c56084df142944875deda791b83c64543bd92ebda5bd5fb1');
assert.equal(JSON.parse(fifteenthBindingBytes).previousSourceBindingsSha256, hash(fourteenthBindingBytes));
const sixteenthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v16.json');
assert.equal(hash(sixteenthBindingBytes), '821e29ac950fa6f42ecd6ad0f6b2de63cc4c301b585ca7878a4e9bd154a4c0c8');
assert.equal(JSON.parse(sixteenthBindingBytes).previousSourceBindingsSha256, hash(fifteenthBindingBytes));
const seventeenthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v17.json');
assert.equal(hash(seventeenthBindingBytes), '3defbf68782371745df469fd075afb870b74f7df8902add3f433ae8fd3059b53');
assert.equal(JSON.parse(seventeenthBindingBytes).previousSourceBindingsSha256, hash(sixteenthBindingBytes));
const eighteenthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v18.json');
assert.equal(hash(eighteenthBindingBytes), '3384ed37cbd7141d4d218646cf4291fd095053120666e524f4ae78a8eac55531');
assert.equal(JSON.parse(eighteenthBindingBytes).previousSourceBindingsSha256, hash(seventeenthBindingBytes));
const nineteenthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v19.json');
assert.equal(hash(nineteenthBindingBytes), '081f309f9789a70b7f54d5c17f62c94c9d1e5905f657a5d23738f6a95418e2a6');
assert.equal(JSON.parse(nineteenthBindingBytes).previousSourceBindingsSha256, hash(eighteenthBindingBytes));
const twentiethBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v20.json');
assert.equal(hash(twentiethBindingBytes), '1e38912657c79954898bda76407ee29e8f2461997b63c267db57b11593c48e1c');
assert.equal(JSON.parse(twentiethBindingBytes).previousSourceBindingsSha256, hash(nineteenthBindingBytes));
const twentyfirstBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v21.json');
assert.equal(hash(twentyfirstBindingBytes), '7f50787a819a05a5da0ebee86489941fbc347f552cb9607ba9cb32e054066771');
assert.equal(JSON.parse(twentyfirstBindingBytes).previousSourceBindingsSha256, hash(twentiethBindingBytes));
const twentysecondBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v22.json');
assert.equal(hash(twentysecondBindingBytes), 'adcc2cb6fb27bbaabcb59adfb5c237534ee5ff320be707a2e8ab43e7dccd0d84');
assert.equal(JSON.parse(twentysecondBindingBytes).previousSourceBindingsSha256, hash(twentyfirstBindingBytes));
const twentythirdBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v23.json');
assert.equal(hash(twentythirdBindingBytes), '245482ba4e4ac00022db4facacd6250205993452e5f09423d2cb61c94a7c50b1');
assert.equal(JSON.parse(twentythirdBindingBytes).previousSourceBindingsSha256, hash(twentysecondBindingBytes));
const twentyfourthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v24.json');
assert.equal(hash(twentyfourthBindingBytes), 'b606753892b5420de25f36a29de3c96413a94334621d807ef756ff7169930cba');
assert.equal(JSON.parse(twentyfourthBindingBytes).previousSourceBindingsSha256, hash(twentythirdBindingBytes));
const twentyfifthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v25.json');
assert.equal(hash(twentyfifthBindingBytes), '67dc4eedf30951cd264e6039673eb140d723daa972b9a891d6b8602096de638f');
assert.equal(JSON.parse(twentyfifthBindingBytes).previousSourceBindingsSha256, hash(twentyfourthBindingBytes));
const twentysixthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v26.json');
assert.equal(hash(twentysixthBindingBytes), '75207edeeba173c6bee65c72a74ced848da8c8c13d8b476ffda7d8074621fceb');
assert.equal(JSON.parse(twentysixthBindingBytes).previousSourceBindingsSha256, hash(twentyfifthBindingBytes));
const twentyseventhBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v27.json');
assert.equal(hash(twentyseventhBindingBytes), '774a341e0881fa9f91f81878d1f9906d828a9c7ec65fb4e86c0c1facea19d912');
assert.equal(JSON.parse(twentyseventhBindingBytes).previousSourceBindingsSha256, hash(twentysixthBindingBytes));
const twentyeighthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v28.json');
assert.equal(hash(twentyeighthBindingBytes), '58ad8912f29a74eb7627b11bba1fc90ef52eacf5b923525911d58efccdba7178');
assert.equal(JSON.parse(twentyeighthBindingBytes).previousSourceBindingsSha256, hash(twentyseventhBindingBytes));
const twentyninthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v29.json');
assert.equal(hash(twentyninthBindingBytes), '331ee878524a8c7013e01d4723927384f06af40b9cdce42f5a96aeefe9911152');
assert.equal(JSON.parse(twentyninthBindingBytes).previousSourceBindingsSha256, hash(twentyeighthBindingBytes));
const thirtiethBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v30.json');
assert.equal(hash(thirtiethBindingBytes), '930bc4ce51055468acab09b6ab4c8c2751e3a6fbbae14fe271e01442f193b6f7');
assert.equal(JSON.parse(thirtiethBindingBytes).previousSourceBindingsSha256, hash(twentyninthBindingBytes));
const thirtyfirstBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v31.json');
assert.equal(hash(thirtyfirstBindingBytes), '37ad6c3820b9eae99dcdeada56a53637e6057c8bcb9990a32e8cf288c117b10b');
assert.equal(JSON.parse(thirtyfirstBindingBytes).previousSourceBindingsSha256, hash(thirtiethBindingBytes));
const thirtysecondBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v32.json');
assert.equal(hash(thirtysecondBindingBytes), '8fbf4117e7e64cc986f318abac7d7211c3e2ccc0029b3881e082e1c9b5e1cf35');
assert.equal(JSON.parse(thirtysecondBindingBytes).previousSourceBindingsSha256, hash(thirtyfirstBindingBytes));
const thirtythirdBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v33.json');
assert.equal(hash(thirtythirdBindingBytes), '18ecff0c7b185c3739b6ac1adb95776c95b1b157f2bfd4427d142473ca6aa891');
assert.equal(JSON.parse(thirtythirdBindingBytes).previousSourceBindingsSha256, hash(thirtysecondBindingBytes));
const thirtyfourthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v34.json');
assert.equal(hash(thirtyfourthBindingBytes), 'e278ef91c638b09e4629c56ba8514c81ccce2a78dd1e45f0fd0eb1d4343852c7');
assert.equal(JSON.parse(thirtyfourthBindingBytes).previousSourceBindingsSha256, hash(thirtythirdBindingBytes));
const thirtyfifthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v35.json');
assert.equal(hash(thirtyfifthBindingBytes), '4b6321158c16c6518a387c3c5639cf5659f89228629b6e9060a6a64e18d5813a');
assert.equal(JSON.parse(thirtyfifthBindingBytes).previousSourceBindingsSha256, hash(thirtyfourthBindingBytes));
const thirtysixthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v36.json');
assert.equal(hash(thirtysixthBindingBytes), '51c22e6e6857ec2cb08544f96c07f085ceb5d211ab64be65d084b4027afc6bb3');
assert.equal(JSON.parse(thirtysixthBindingBytes).previousSourceBindingsSha256, hash(thirtyfifthBindingBytes));
const thirtyseventhBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v37.json');
assert.equal(hash(thirtyseventhBindingBytes), 'ecc37a857be962594f14746ac7d69eb553b79f146d226664bf78040e6310c28c');
assert.equal(JSON.parse(thirtyseventhBindingBytes).previousSourceBindingsSha256, hash(thirtysixthBindingBytes));
const thirtyeighthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v38.json');
assert.equal(hash(thirtyeighthBindingBytes), '122eb725d43663b5c0251f7f742d49fc34e0e46790c6302e5cd3bd57b96b0395');
assert.equal(JSON.parse(thirtyeighthBindingBytes).previousSourceBindingsSha256, hash(thirtyseventhBindingBytes));
const thirtyninthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v39.json');
assert.equal(hash(thirtyninthBindingBytes), '26f70c508f11b65cdf76b627cb793c6e063bad19c10d4ee0518b7e88d09b7eab');
assert.equal(JSON.parse(thirtyninthBindingBytes).previousSourceBindingsSha256, hash(thirtyeighthBindingBytes));
const fortiethBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v40.json');
assert.equal(hash(fortiethBindingBytes), 'b687bd2ad80572735fbe9cb994b35613e657520ae1efadf5e4439f9797fcb533');
assert.equal(JSON.parse(fortiethBindingBytes).previousSourceBindingsSha256, hash(thirtyninthBindingBytes));
const fortyfirstBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v41.json');
assert.equal(hash(fortyfirstBindingBytes), 'a5429def6273b1081fcc853fe24e8442eabd371c2c22cdfb23b75cc29146d1fe');
assert.equal(JSON.parse(fortyfirstBindingBytes).previousSourceBindingsSha256, hash(fortiethBindingBytes));
const fortysecondBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v42.json');
assert.equal(hash(fortysecondBindingBytes), '42cf05fe935bddd20d344c027fae2df385eb229b6296b5f048d898f8647f6e24');
assert.equal(JSON.parse(fortysecondBindingBytes).previousSourceBindingsSha256, hash(fortyfirstBindingBytes));
const fortythirdBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v43.json');
assert.equal(hash(fortythirdBindingBytes), 'd13220f67fe38114e7d0ea0d96310caa76979389bce9b689b5d037813651cbfa');
assert.equal(JSON.parse(fortythirdBindingBytes).previousSourceBindingsSha256, hash(fortysecondBindingBytes));
const bindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v44.json');
assert.equal(hash(bindingBytes), BINDINGS_HASH, 'Reviewed source bindings differ.');
export const sourceBindings = JSON.parse(bindingBytes);
assert.equal(sourceBindings.previousSourceBindingsSha256, hash(fortythirdBindingBytes), 'Previous source binding history differs.');
const rows = new Map(sourceBindings.sources.map(row => [row.path, row]));
assert.equal(rows.size, sourceBindings.sources.length, 'Duplicate source binding.');
export function assertBoundSource(path, bytes) {
  const row = rows.get(path);
  assert.ok(row, `Unreviewed source path: ${path}`);
  assert.equal(bytes.length, row.byteLength, `Bound source length differs: ${path}`);
  assert.equal(hash(bytes), row.sha256, `Bound source hash differs: ${path}`);
}
export function validateSourceBindings() {
  for (const row of rows.values()) assertBoundSource(row.path, regularFile(SOURCE_ROOT, row.path));
}
export function validatePublicManifest(bytes) {
  assert.equal(hash(bytes), MANIFEST_HASH, 'Immutable public manifest differs.');
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.previousManifestSha256, hash(thirtysixthManifestBytes), 'Public manifest history differs.');
  assert.deepEqual(manifest.objects, historicalManifest.objects, 'Immutable packed objects differ.');
  assert.deepEqual(manifest.observationBindings, historicalManifest.observationBindings, 'Immutable observation bindings differ.');
  assert.deepEqual(manifest.pack, historicalManifest.pack, 'Immutable public pack differs.');
  assert.equal(manifest.pack.count, 272);
  assert.equal(manifest.objects.length, 272);
  assert.equal(new Set(manifest.objects.map(row => row.oid)).size, 272);
  assert.equal(manifest.pack.byteLength, 552150);
  assert.equal(manifest.pack.sha256, PACK_HASH);
  for (const member of manifest.members) {
    const path = member.path.startsWith('checkout/') ? member.path.slice('checkout/'.length) : member.path;
    const bytes = regularFile(member.path.startsWith('checkout/') ? SOURCE_ROOT : FIXTURE_ROOT, path);
    assert.equal(bytes.length, member.byteLength, `Public member length differs: ${path}`);
    assert.equal(hash(bytes), member.sha256, `Public member hash differs: ${path}`);
  }
  return manifest;
}
const fourthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v4.json');
assert.equal(hash(fourthManifestBytes), '8cb6ecd4be8b5a62576e1142242df1c22dcd27678580b69b6404419eeb6d144d', 'Fourth public manifest differs.');
assert.equal(JSON.parse(fourthManifestBytes).previousManifestSha256, hash(thirdManifestBytes));
const fifthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v5.json');
assert.equal(hash(fifthManifestBytes), '7b0eee9085e29c3a1ab009bf7c285d71c3cae81faa5841d39ee79063f5a05363', 'Fifth public manifest differs.');
assert.equal(JSON.parse(fifthManifestBytes).previousManifestSha256, hash(fourthManifestBytes));
const sixthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v6.json');
assert.equal(hash(sixthManifestBytes), '736ed1fbf04ac6bf7ea45cb365a6e43b5d41494a9041f64697d693cddde052c0');
assert.equal(JSON.parse(sixthManifestBytes).previousManifestSha256, hash(fifthManifestBytes));
const seventhManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v7.json');
assert.equal(hash(seventhManifestBytes), 'd4e8b34a6904dc83b642d54be339401258a71466afa3157832bf896dd72a7314');
assert.equal(JSON.parse(seventhManifestBytes).previousManifestSha256, hash(sixthManifestBytes));
const eighthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v8.json');
assert.equal(hash(eighthManifestBytes), '8af0199a91dc0b1affc46f794b94972fc1ef7cd6dd4c00e8b1dae16f04710541');
assert.equal(JSON.parse(eighthManifestBytes).previousManifestSha256, hash(seventhManifestBytes));
const ninthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v9.json');
assert.equal(hash(ninthManifestBytes), 'abe42cbf7030eed188c7af89063be413d2937015a285237c82e07371097a0f3c');
assert.equal(JSON.parse(ninthManifestBytes).previousManifestSha256, hash(eighthManifestBytes));
const tenthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v10.json');
assert.equal(hash(tenthManifestBytes), 'ef7cf4031d799e023d643f1f6666597d43e87cc6b52dfb7bc83440f25358cb44');
assert.equal(JSON.parse(tenthManifestBytes).previousManifestSha256, hash(ninthManifestBytes));
const eleventhManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v11.json');
assert.equal(hash(eleventhManifestBytes), '18b36ccca6f50b55be34e7cf3f10bc50f3e946414e25721a9b029b75f53f9a46');
assert.equal(JSON.parse(eleventhManifestBytes).previousManifestSha256, hash(tenthManifestBytes));
const twelfthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v12.json');
assert.equal(hash(twelfthManifestBytes), '8017794dbdb144ac91d20e9195a3cc76f0ffdafe3bb7d4fe8be2c075007d2c8f');
assert.equal(JSON.parse(twelfthManifestBytes).previousManifestSha256, hash(eleventhManifestBytes));
const thirteenthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v13.json');
assert.equal(hash(thirteenthManifestBytes), '94c7324ea97003c94502e5a3f6357f374ccd5c43e90ca2212a17955c9dd5ab47');
assert.equal(JSON.parse(thirteenthManifestBytes).previousManifestSha256, hash(twelfthManifestBytes));
const fourteenthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v14.json');
assert.equal(hash(fourteenthManifestBytes), '8f98fa911e69955317d44b17ac9a4a0f4d057143ea4e3b28183311c4ba402bad');
assert.equal(JSON.parse(fourteenthManifestBytes).previousManifestSha256, hash(thirteenthManifestBytes));
const fifteenthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v15.json');
assert.equal(hash(fifteenthManifestBytes), '958b59a35d5c01eb83b9ad3b6615cf2bebcec840381962b0f4367643783229ba');
assert.equal(JSON.parse(fifteenthManifestBytes).previousManifestSha256, hash(fourteenthManifestBytes));
const sixteenthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v16.json');
assert.equal(hash(sixteenthManifestBytes), '8add798b253d61ef25601ed8c5173aaab094363d0726770f98db0e3516d5b0e3');
assert.equal(JSON.parse(sixteenthManifestBytes).previousManifestSha256, hash(fifteenthManifestBytes));
const seventeenthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v17.json');
assert.equal(hash(seventeenthManifestBytes), '32ef0676db7a77868dab8e5f25db79e5f449d1a1c05005d404f2704079bd58b5');
assert.equal(JSON.parse(seventeenthManifestBytes).previousManifestSha256, hash(sixteenthManifestBytes));
const eighteenthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v18.json');
assert.equal(hash(eighteenthManifestBytes), 'c618cf627444dfe263ef699c4f6df611350ffb23dd52f4394e6a10f7f5a379f0');
assert.equal(JSON.parse(eighteenthManifestBytes).previousManifestSha256, hash(seventeenthManifestBytes));
const nineteenthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v19.json');
assert.equal(hash(nineteenthManifestBytes), '504504e0923b28028c3b97a0e2c81cf112799fda2d095e4491419b7724f7722a');
assert.equal(JSON.parse(nineteenthManifestBytes).previousManifestSha256, hash(eighteenthManifestBytes));
const twentiethManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v20.json');
assert.equal(hash(twentiethManifestBytes), '6a88678d7d9922e71734c342c03f57694f00bcf51a90a15a104aed32dd1fe1e6');
assert.equal(JSON.parse(twentiethManifestBytes).previousManifestSha256, hash(nineteenthManifestBytes));
const twentyfirstManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v21.json');
assert.equal(hash(twentyfirstManifestBytes), 'c0d5dc48fb4900d5ffea1e709ab117ba63970c43d129f90548dfc9f4ba6872e9');
assert.equal(JSON.parse(twentyfirstManifestBytes).previousManifestSha256, hash(twentiethManifestBytes));
const twentysecondManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v22.json');
assert.equal(hash(twentysecondManifestBytes), '86aa162eed0592db84676c258d9eb9719090925873d2a0a68415dbfb3c6073f7');
assert.equal(JSON.parse(twentysecondManifestBytes).previousManifestSha256, hash(twentyfirstManifestBytes));
const twentythirdManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v23.json');
assert.equal(hash(twentythirdManifestBytes), 'ca45769771f1c2d68804f5c45cbc1b74b72dd90d34b14b214c37ec9624ee18c9');
assert.equal(JSON.parse(twentythirdManifestBytes).previousManifestSha256, hash(twentysecondManifestBytes));
const twentyfourthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v24.json');
assert.equal(hash(twentyfourthManifestBytes), '63f4437db7d92c460f8f859d4e70f90b03824cb83d3c6df786dbccddb250c88f');
assert.equal(JSON.parse(twentyfourthManifestBytes).previousManifestSha256, hash(twentythirdManifestBytes));
const twentyfifthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v25.json');
assert.equal(hash(twentyfifthManifestBytes), 'a428b34b63b836a8b6feba3526c82ba15f4300e48d18ce9ae118b00950a174b8');
assert.equal(JSON.parse(twentyfifthManifestBytes).previousManifestSha256, hash(twentyfourthManifestBytes));
const twentysixthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v26.json');
assert.equal(hash(twentysixthManifestBytes), '1cd450caabb6b406474819b8ab143ba716089c946027e2b0bf8d67b39202055d');
assert.equal(JSON.parse(twentysixthManifestBytes).previousManifestSha256, hash(twentyfifthManifestBytes));
const twentyseventhManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v27.json');
assert.equal(hash(twentyseventhManifestBytes), 'f0cf7066f59f3ba31a189ac00b3542c5a5228d48644d5d21fad142b47f882e24');
assert.equal(JSON.parse(twentyseventhManifestBytes).previousManifestSha256, hash(twentysixthManifestBytes));
const twentyeighthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v28.json');
assert.equal(hash(twentyeighthManifestBytes), '9d55fa0cce6d14228a11615ce0b999ab7a731cc51dd2ed51ee69962909fcc403');
assert.equal(JSON.parse(twentyeighthManifestBytes).previousManifestSha256, hash(twentyseventhManifestBytes));
const twentyninthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v29.json');
assert.equal(hash(twentyninthManifestBytes), 'f501f405eb8700e4000b8b8111149914446cc6c200ffea0f48f1a7b29bf7de05');
assert.equal(JSON.parse(twentyninthManifestBytes).previousManifestSha256, hash(twentyeighthManifestBytes));
const thirtiethManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v30.json');
assert.equal(hash(thirtiethManifestBytes), '26eed1659f1092ce1f4591bcb43f19bc5530e5cc90dd5a17c63b268476e21078');
assert.equal(JSON.parse(thirtiethManifestBytes).previousManifestSha256, hash(twentyninthManifestBytes));
const thirtyfirstManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v31.json');
assert.equal(hash(thirtyfirstManifestBytes), 'af1de9646f570faa70ac65807158b9746358b544f47f4cc8bff96eb988a5c214');
assert.equal(JSON.parse(thirtyfirstManifestBytes).previousManifestSha256, hash(thirtiethManifestBytes));
const thirtysecondManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v32.json');
assert.equal(hash(thirtysecondManifestBytes), '7438b5d3eda42f6cfdde637de431ed383c9252f7f9dac623aa883662e6cbc19b');
assert.equal(JSON.parse(thirtysecondManifestBytes).previousManifestSha256, hash(thirtyfirstManifestBytes));
const thirtythirdManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v33.json');
assert.equal(hash(thirtythirdManifestBytes), 'bec6c20695105d2ea27a137aaaf1ca95da40d07e3b32399da7af1dc1130e2a61');
assert.equal(JSON.parse(thirtythirdManifestBytes).previousManifestSha256, hash(thirtysecondManifestBytes));
const thirtyfourthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v34.json');
assert.equal(hash(thirtyfourthManifestBytes), '55dc0b4d5902a0fe25e6d325bc6bcff743f7574486a5eac93bae2cacc6a13060');
assert.equal(JSON.parse(thirtyfourthManifestBytes).previousManifestSha256, hash(thirtythirdManifestBytes));
const thirtyfifthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v35.json');
assert.equal(hash(thirtyfifthManifestBytes), '8791a762cee8f2af0568ec5fc78f8c7ff5487267d580169ea75a78e2f28748eb');
assert.equal(JSON.parse(thirtyfifthManifestBytes).previousManifestSha256, hash(thirtyfourthManifestBytes));
const thirtysixthManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v36.json');
assert.equal(hash(thirtysixthManifestBytes), 'b917eb2aa790d738e6aa00c605775d116d76553066b46ffc3b95658c26c5d478');
assert.equal(JSON.parse(thirtysixthManifestBytes).previousManifestSha256, hash(thirtyfifthManifestBytes));
export const manifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v37.json');
export const manifest = validatePublicManifest(manifestBytes);
export const pack = regularFile(FIXTURE_ROOT, 'objects-v2.pack');
assert.equal(pack.length, 552150); assert.equal(hash(pack), PACK_HASH);
// Run before any test body or module evaluation. All source is the actual
// repository source; no historical checkout/module copies are versioned here.
validateSourceBindings();
export function copyBoundSource(targetRoot, path, targetPath = path) {
  const bytes = regularFile(SOURCE_ROOT, path); assertBoundSource(path, bytes);
  const destination = join(targetRoot, targetPath);
  assert.ok(!relative(targetRoot, destination).startsWith('..'), 'Temporary copy escaped fixture root.');
  fs.mkdirSync(dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
}
export const cleanGitEnvironment = () => ({ PATH: process.env.PATH,
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' });

const CONTROL_MANIFEST_HASH = '635b20628f0e43f9ded35b6a64dbfed7610b17454302288dd29927a3cd9da7fc';
export const controlManifestBytes = regularFile(FIXTURE_ROOT, 'control-objects-v1.json');
export function validateControlManifest(bytes) {
  assert.equal(hash(bytes), CONTROL_MANIFEST_HASH, 'Frozen control supplement manifest differs.');
  const value = JSON.parse(bytes);
  assert.equal(value.pack.count, 3); assert.equal(value.objects.length, 3);
  assert.equal(new Set(value.objects.map(row => row.oid)).size, 3);
  assert.equal(value.mandatoryCandidateControls.length, 13);
  assert.equal(new Set(value.mandatoryCandidateControls.map(row => row.path)).size, 13);
  assert.equal(value.original272PackSha256, PACK_HASH);
  return value;
}
export const controlManifest = validateControlManifest(controlManifestBytes);
export const controlPack = regularFile(FIXTURE_ROOT, controlManifest.pack.path);
assert.equal(controlPack.length, controlManifest.pack.byteLength); assert.equal(hash(controlPack), controlManifest.pack.sha256);

// Only fresh disposable test repositories call this helper. Both immutable
// public carriers are consumed by native Git with no alternates or fetch.
export function installPortableObjects(cwd) {
  assert.equal(fs.existsSync(join(cwd, '.git/objects/info/alternates')), false);
  const git = (args, input) => execFileSync('git', ['--no-replace-objects', ...args], { cwd, input, env: cleanGitEnvironment(), maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  assert.equal(git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname)']).length, 0, 'Empty fixture object store required.');
  git(['index-pack', '--stdin'], pack);
  const count = () => git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname)']).toString().trim().split('\n').length;
  const verifyObjects = rows => {
    // Every object is immutable and keyed by the authenticated exact OID. One
    // batch retains each original type/length/body-hash check without spawning
    // two Git processes per object. No current-source boundary is cached.
    const bytes = git(['cat-file', '--batch'], Buffer.from(`${rows.map(row => row.oid).join('\n')}\n`)); let offset = 0;
    for (const row of rows) {
      const end = bytes.indexOf(10, offset); assert.ok(end > offset);
      assert.equal(bytes.subarray(offset, end).toString(), `${row.oid} ${row.type} ${row.byteLength}`);
      const body = bytes.subarray(end + 1, end + 1 + row.byteLength); assert.equal(body.length, row.byteLength);
      assert.equal(hash(body), row.sha256);
      assert.equal(createHash('sha1').update(`${row.type} ${body.length}\0`).update(body).digest('hex'), row.oid);
      offset = end + 1 + row.byteLength; assert.equal(bytes[offset++], 10);
    }
    assert.equal(offset, bytes.length, 'Exact batch object membership required.');
  };
  assert.equal(count(), 272);
  verifyObjects(manifest.objects);
  git(['index-pack', '--stdin'], controlPack); assert.equal(count(), 275);
  assert.ok(controlManifest.objects.every(row => row.type === 'blob')); verifyObjects(controlManifest.objects);
  for (const row of controlManifest.mandatoryCandidateControls) {
    const tree = git(['ls-tree', controlManifest.candidateSha, '--', row.path]).toString().trim();
    assert.equal(tree, `${row.mode} blob ${row.oid}\t${row.path}`);
    const bytes = git(['show', `${controlManifest.candidateSha}:${row.path}`]);
    assert.equal(bytes.length, row.byteLength); assert.equal(hash(bytes), row.sha256);
  }
  // This existing current public file is byte-identical to its frozen04ee
  // signer blob. Authenticate it through the current-source binding and the
  // candidate raw tree OID, without expanding either immutable carrier.
  const signerPath = 'api/_emailRouterHandlers.js';
  const signerBytes = regularFile(SOURCE_ROOT, signerPath);
  assertBoundSource(signerPath, signerBytes);
  const signerOid = git(['rev-parse', `${controlManifest.candidateSha}:${signerPath}`]).toString().trim();
  assert.equal(signerOid, '5429dc7062ea2a14155a99915b20176801a66449');
  assert.equal(hash(signerBytes), '4d3e301b18fba542e9cb8adc982a7653f0f338c704501780df9b146698a644ee');
  assert.equal(git(['hash-object', '-w', '--stdin'], signerBytes).toString().trim(), signerOid);
  assert.equal(count(), 276);
}
