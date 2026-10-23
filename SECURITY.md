# Security and privacy

Report vulnerabilities privately through the repository's GitHub security reporting or contact its maintainer. Do not publish image content or credentials in issues.

Inputs are untrusted data. Byte signatures, dimensions and native decode must agree; 10 MiB, 16 MP and 8192px-side limits apply before decode. Outputs use trusted native PNG encoding. Source EXIF is not copied. Packages are at most 8 MiB and 20 bounded STORE entries; no paths, compression, symlinks, encryption, execution or shell extraction. Checksums, exact output inventories and asset SHA-256 are checked before adoption. SVG input is unsupported. CSP restricts code, fonts and network to same origin; previews use local blob URLs. Source bytes/text/filenames never enter network requests or analytics. Hosting access logs still apply to ordinary page requests.
