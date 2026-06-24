using System.Collections.Generic;
using System.Linq;
using TMPro;
using UnityEngine;

public class StarVisual : MonoBehaviour
{
  [SerializeField] private Star star;

  [SerializeField] private TextMeshPro nameText;
  [SerializeField] private Renderer sphereRenderer;
  [SerializeField] private SphereMaterialCatalogSO sphereMaterialCatalog;
  [SerializeField] private List<CrystalType_GameObject> crystalTypeVisualMap;

  [Header("Switched sections")]
  [SerializeField] private GameObject sphere;
  [SerializeField] private GameObject crystal;

  private void Start()
  {
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
    ShowTitle(true);
    ShowSphere(true);
    ShowCrysyal(true);
  }

  private void SetPlainView()
  {
    ShowTitle(true);
    ShowSphere(true);
    ShowCrysyal(false);
  }

  private void ShowTitle(bool show)
  {
    nameText.gameObject.SetActive(show);
    if (!show) return;

    nameText.text = star.Data.Name;
  }

  private void ShowSphere(bool show)
  {
    sphere.SetActive(show);
    if (!show) return;

    var sphereMap = ResolveRandomSphereMaterial();
    sphereRenderer.material = sphereMap?.material ?? sphereMaterialCatalog.defaultMaterial;
  }

  private void ShowCrysyal(bool show)
  {
    crystal.SetActive(show);
    if (!show) return;

    var selectedCore = ResolveCrystalTypeByDirectLinkCount(star.Data.DirectLinkCount);
    var hasSelectedCore = crystalTypeVisualMap.Any(x => x.crystalType == selectedCore);
    if (!hasSelectedCore)
      // Prefab variants can lag code buckets; keep a visible core instead of hiding the section.
      selectedCore = crystalTypeVisualMap.FirstOrDefault()?.crystalType ?? CrystalType.Unknown;

    foreach (var crystalPair in crystalTypeVisualMap)
    {
      crystalPair.gameObject
        .SetActive(crystalPair.crystalType == selectedCore);
    }
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
}
