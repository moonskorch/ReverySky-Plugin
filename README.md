ReverySky Map is an Obsidian desktop plugin that renders vault relationships in a Unity WebGL runtime embedded in a custom Obsidian view.

## Runtime and source availability

The current release candidate build uses the `embedded-archive` package mode. Other package modes and release shapes are documented in [Packaging Modes](docs/PACKAGING_MODES.md).

The Obsidian plugin source code and the Unity project source code are available in this repository. In the `embedded-archive` package mode, the released `main.js` also contains a generated Unity WebGL build archive, including Unity-generated JavaScript, WebAssembly, data files, and runtime assets.

The Unity engine/runtime is proprietary third-party technology distributed under Unity's terms. The plugin does not download the Unity runtime from the network. On first map open, the embedded runtime archive is extracted into a versioned local cache inside the installed plugin folder:

`.obsidian/plugins/reverysky-map/.reverysky-runtime/<version>/`

Later launches reuse that local cache.

See the third-party notices for bundled visual assets and runtime dependencies.

## License

Original source code and project-owned materials are licensed under the
[MIT License](LICENSE.md).

## Third-party visual assets

The built plugin uses several third-party visual assets. Their raw source files
are intentionally excluded from Git and must be added manually for local Unity
development.

See [third-party notices](unity/ReverySkyMap/Assets/ThirdPartyNotices.txt) and
[Unity setup instructions](unity/ReverySkyMap/Assets/README.txt).

