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
    sphereRenderer.sharedMaterial = sphereMap?.material ?? sphereMaterialCatalog.defaultMaterial;
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
    var materials = sphereMaterialCatalog.materials;
    int validCount = 0;
    for (int i = 0; i < materials.Count; i++)
    {
      if (IsSelectableSphereMaterial(materials[i]))
        validCount++;
    }

    if (validCount == 0)
      return null;

    int selectedOffset = StableIndex(BuildStableVisualSeed(), validCount);

    for (int i = 0; i < materials.Count; i++)
    {
      var candidate = materials[i];
      if (!IsSelectableSphereMaterial(candidate))
        continue;

      if (selectedOffset == 0)
        return candidate;

      selectedOffset--;
    }

    return null;
  }

  private static bool IsSelectableSphereMaterial(SphereType_Material candidate)
  {
    return candidate != null &&
      candidate.material != null &&
      candidate.sphereType != SphereType.Black;
  }

  private static int StableIndex(int seed, int count)
  {
    if (count <= 0)
      return 0;

    unchecked
    {
      return (int)((uint)seed % (uint)count);
    }
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
    var multipliers = crystalScaleMapper.multipliers;
    for (int i = 0; i < multipliers.Count; i++)
    {
      var candidate = multipliers[i];
      if (candidate != null && candidate.crystalType == crystalType)
        return candidate.scaleMultiplier;
    }

    return crystalScaleMapper.defaultScale;
  }
}
