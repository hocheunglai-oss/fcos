# One-time hosted toolchain publication

`hosted-release-toolchain.yml` publishes the reviewed verification image with GitHub's short-lived `GITHUB_TOKEN`. It does not require expanding the Mac's personal token permissions. The workflow is disabled by default and cannot deploy FCOS, access provider credentials, admit its own output or activate coordination.

Before dispatch, the setup operator verifies the pinned GitHub identity and repository, acquires the **existing canonical provider-write lease**, and records a durable intent for one registry publication from the exact reviewed source. Set `FCOS_HOSTED_TOOLCHAIN_SOURCE_SHA` to that immutable source and `FCOS_HOSTED_TOOLCHAIN_INTENT_SHA256` to the intent digest, then enable `FCOS_HOSTED_TOOLCHAIN_SETUP_ENABLED`. These setup writes and the dispatch are covered by that same held lease and exact scope. Do not release the lease merely because GitHub accepted dispatch.

Dispatch from protected `main` as the pinned repository owner with those exact two inputs. Only first attempts are admitted. The build job has read-only source access and no registry/provider secret. It builds Linux AMD64, verifies the non-root image user and records actual runtime versions. The separate publisher loads the byte-checked artifact without executing it, obtains registry write access only for its one push, reads the immutable registry digest, and removes its temporary Docker login.

After the run, independently verify the actual protected run, source, successful build and publication jobs, artifact digests, registry digest and source label. Retain the image by digest in the reviewed setup. Publication alone is **not** hosted qualification or image admission. Resolve the old lease only from that actual readback and root acceptance.

A failed or lost push response is uncertain. Preserve the original publication intent, use registry GET-only readback for its exact tag, and never rerun a consumed invocation or infer that an absent listing proves no write. The tag includes source and run ID; it is not used as the release runtime reference.

Disable this one-time workflow after publication. Include it in the complete old-writer inventory and permanent fencing before the new coordinator epoch is installed. The setup enable flag is not routine release authority; an active epoch must not coexist with this independently coordinated publisher. Routine releases reuse the qualified immutable image and do not rebuild or republish it.
