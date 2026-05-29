using UnityEngine;

/// <summary>
/// Component for displaying texture on a quad mesh.
/// Uses a shared material with a <see cref="MaterialPropertyBlock"/> so that
/// each quad instance can have its own texture without duplicating materials.
/// If no texture is assigned, a transparent 1x1 texture is used as a safe fallback.
/// </summary>
[RequireComponent(typeof(MeshRenderer))]
public class TextureRenderer : MonoBehaviour
{
  private MeshRenderer _renderer;
  private MaterialPropertyBlock _mpb;

  /// <summary>
  /// The shader property ID for the base texture slot in URP Lit/Unlit materials.
  /// </summary>
  private static readonly int ID_BaseMap = Shader.PropertyToID("_BaseMap");

  /// <summary>
  /// Cached static 1x1 transparent texture used to Clear texture or 
  /// as a safe fallback instead of passing <c>null</c> to a material property.
  /// </summary>
  private static Texture2D _transparent1x1;

  /// <summary>
  /// Returns a lazily created 1x1 transparent texture.
  /// This is used whenever no valid texture is provided, to avoid
  /// <see cref="System.ArgumentException"/> when assigning <c>null</c>.
  /// </summary>
  private static Texture2D Transparent1x1
  {
    get
    {
      if (_transparent1x1 == null)
      {
        _transparent1x1 = new Texture2D(1, 1, TextureFormat.RGBA32, false);
        _transparent1x1.SetPixel(0, 0, new Color(0, 0, 0, 0));
        _transparent1x1.Apply(false, true);
        _transparent1x1.wrapMode = TextureWrapMode.Clamp;
        _transparent1x1.filterMode = FilterMode.Bilinear;
        _transparent1x1.name = "Transparent1x1";
        _transparent1x1.hideFlags = HideFlags.DontSaveInBuild | HideFlags.DontSaveInEditor;
      }
      return _transparent1x1;
    }
  }

  void Awake()
  {
    _renderer = GetComponent<MeshRenderer>();
    _mpb = new MaterialPropertyBlock();
  }

  /// <summary>
  /// Assigns a texture to this object's material property block.
  /// If <paramref name="tex"/> is <c>null</c>, a transparent 1x1 texture is applied instead.
  /// </summary>
  /// <param name="tex">The texture to apply, or <c>null</c> to clear.</param>
  public void SetTexture(Texture tex)
  {
    var safeTex = tex != null ? tex : Transparent1x1;

    _renderer.GetPropertyBlock(_mpb);
    _mpb.SetTexture(ID_BaseMap, safeTex);
    _renderer.SetPropertyBlock(_mpb);
  }

  /// <summary>
  /// Clears the current texture by assigning a transparent 1x1 texture.
  /// </summary>
  public void ClearTexture() => SetTexture(null);
}
