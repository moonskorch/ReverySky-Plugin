using System.Linq;
using TMPro;
using UnityEngine;

public class StarVisual : MonoBehaviour
{
  [SerializeField] private Star star;

  [SerializeField] private TextMeshPro nameText;
  [SerializeField] private Renderer sphereRenderer;
  [SerializeField] private Transform crystalCore;
  [SerializeField] private SphereMaterialCatalogSO sphereMaterialCatalog;
  [SerializeField] private CrystalTypeScaleMapperSO crystalScaleMapper;

  [Header("Switched sections")]
  [SerializeField] private GameObject sphere;
  [SerializeField] private GameObject crystal;

  private Vector3 crystalCoreBaseScale = Vector3.one;

  private void Start()
  {
    crystalCoreBaseScale = crystalCore.localScale;
    star.OnDataChanged += UpdateVisual;
    UpdateVisual();
  }

  private void OnDisable()
  {
    star.OnDataChanged -= UpdateVisual;
  }

  private void UpdateVisual()
  {
    var view = star.Data.ScapeView;
    switch (view)
    {
      case ScapeView.Planets:
        SetPlanetView();
        break;
      case ScapeView.Plain:
        SetPlainView();
        break;
      default:
        SetPlanetView();
        Debug.LogWarning($"[StarVisual] Unknown view {view}, fallback to Planets.");
        return;
    }
  }

  private void SetPlanetView()
  {
    UpdateTitle();
    ShowSphere(true);
    ShowCrystal(true);
  }

  private void SetPlainView()
  {
    UpdateTitle();
    ShowSphere(true);
    ShowCrystal(false);
  }

  private void UpdateTitle()
  {
    nameText.text = star.Data.Name;
  }

  private void ShowSphere(bool show)
  {
    sphere.SetActive(show);
    if (!show) return;

    var sphereMap = ResolveRandomSphereMaterial();
    sphereRenderer.material = sphereMap?.material ?? sphereMaterialCatalog.defaultMaterial;
  }

  private void ShowCrystal(bool show)
  {
    crystal.SetActive(show);
    if (!show) return;

    var selectedCore = ResolveCrystalTypeByDirectLinkCount(star.Data.DirectLinkCount);
    var scaleMultiplier = ResolveCrystalScaleMultiplier(selectedCore);
    crystalCore.localScale = crystalCoreBaseScale * scaleMultiplier;
  }

  private SphereType_Material ResolveRandomSphereMaterial()
  {
    var colorPalette = sphereMaterialCatalog.materials
      .Where(x =>
        x != null &&
        x.material != null &&
        x.sphereType != SphereType.Black)
      .ToList();

    if (!colorPalette.Any())
      return null;

    return Rng.Pick(colorPalette, BuildStableVisualSeed());
  }

  private int BuildStableVisualSeed()
  {
    string stableKey = star.Data.Path ?? string.Empty;

    unchecked
    {
      int hash = 23;
      for (int i = 0; i < stableKey.Length; i++)
        hash = (hash * 31) + stableKey[i];

      return hash;
    }
  }

  private static CrystalType ResolveCrystalTypeByDirectLinkCount(int directLinkCount)
  {
    if (directLinkCount <= 0)
      return CrystalType.Value1;

    if (directLinkCount == 1)
      return CrystalType.Value2;

    return CrystalType.Value3;
  }

  private float ResolveCrystalScaleMultiplier(CrystalType crystalType)
  {
    var selectedScale = crystalScaleMapper.multipliers
      .FirstOrDefault(x => x.crystalType == crystalType);

    if (selectedScale != null)
      return selectedScale.scaleMultiplier;

    return crystalScaleMapper.defaultScale;
  }
}
