Some third-party visual source files are intentionally excluded from Git.
They may still be used locally for development/builds, but must be added manually after clone.

Excluded assets (not tracked in this repository):
1) Unity Asset Store (Nebula Skyboxes)
   - Assets/_Visuals/Nebula Skyboxes/Nebula_03_Cubemap.exr
   - Source: https://assetstore.unity.com/packages/2d/textures-materials/sky/nebula-skyboxes-219924

2) Textures4Photoshop
   - Assets/_Visuals/Textures/electric_texture_bw_big_contrast.jpg
   - Source: https://www.textures4photoshop.com/

Post-clone setup:
1) Place the missing files into the exact paths listed above.
2) Open Unity and let asset import finish.
3) Reassign missing references in prefabs/materials if Unity shows missing sprites/textures.
4) For skybox: assign Nebula_03_Cubemap.exr to Assets/_Visuals/Materials/Skybox_Nebula.mat.
