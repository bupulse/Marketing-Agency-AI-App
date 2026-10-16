// The public half of the owner's release signing key (Ed25519, raw 32 bytes in base64). Written by
// `npm run release:zip -- --init`; commit it. The admin console and the deploy workflow (which reads this file from
// main) only install zips signed by the matching private key, kept in the owner's macOS Keychain (docs/UPDATES.md).
// Empty until the owner runs --init: then RELEASE_PUBLIC_KEY (the environment) is used, and installs are refused
// when neither is set.
export const RELEASE_PUBLIC_KEY = "JeuxR48MsmHVdoXBWlt8BIQCC4LN6qb30dhV7Awpv84=";
