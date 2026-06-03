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

Notes:
- Assets/_Visuals/Sprites/nav_menu/arrow_rotate_left.png stays tracked in Git.
- Assets/_Visuals/Sprites/nav_menu/arrow_rotate_right.png stays tracked in Git.
- Tag textures in Assets/_Visuals/Textures/Tags/* are project-owned and remain tracked.

ReverySkyMap_RPAsset -> Upscaling Filter tests
1) FidelityFX Super Resolution (FSR) + Render Scale 0.8
Empty skybox scene: ~27 FPS
Simple spheres: ~25 FPS
Complex shaders + VFX (movement, distortion, halo): ~21 FPS

2) Bilinear + Render Scale 0.85
Empty skybox scene: up to 60 FPS
Simple spheres: ~45 FPS
Complex shaders + VFX: ~37 FPS

3) Bilinear + Render Scale 0.9
Better visual - still decent FPS

Visual notes
Simple spheres look noticeably worse with Bilinear (more aliasing/jaggies).
On complex shaders/VFX, motion, distortion, and glow largely mask the reduced image quality, and the scene looks smoother overall thanks to the higher FPS.
