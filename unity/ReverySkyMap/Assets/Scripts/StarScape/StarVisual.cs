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
  [SerializeField] private BuildingCallout buildingPrefab;

  [Header("Switched sections")]
  [SerializeField] private GameObject sphere;
  [SerializeField] private GameObject crystal;
  [SerializeField] private GameObject buildings;

  private Vector3 crystalCoreBaseScale = Vector3.one;

  private bool titlePrepared;
  private bool spherePrepared;
  private bool crystalPrepared;
  private bool buildingsPrepared;

  private void Start()
  {
    crystalCoreBaseScale = crystalCore.localScale;
    Cartographer.I.OnViewChanged += ApplyView;
    ApplyView(Cartographer.I.CurrentView);
  }

  private void OnDestroy()
  {
    Cartographer.I.OnViewChanged -= ApplyView;
  }

  private void ApplyView(ScapeView view)
  {
    switch (view)
    {
      case ScapeView.Planets:
        SetPlanetView();
        break;
      case ScapeView.Plain:
        SetPlainView();
        break;
      case ScapeView.Buildings:
        SetBuildingsView();
        break;
      default:
        SetPlanetView();
        Debug.LogWarning($"[StarVisual] Unknown view {view}, fallback to Planets.");
        return;
    }
  }

  private void SetPlanetView()
  {
    PrepareTitle();
    ShowSphere(true);
    ShowCrystal(true);
    ShowBuildings(false);
  }

  private void SetPlainView()
  {
    PrepareTitle();
    ShowSphere(true);
    ShowCrystal(false);
    ShowBuildings(false);
  }

  private void SetBuildingsView()
  {
    PrepareTitle();
    ShowSphere(true);
    ShowCrystal(false);
    ShowBuildings(true);
  }

  private void PrepareTitle()
  {
    if (titlePrepared)
      return;

    nameText.text = star.Data.Name;
    titlePrepared = true;
  }

  private void ShowSphere(bool show)
  {
    if (show)
      PrepareSphere();

    if (sphere.activeSelf != show)
      sphere.SetActive(show);
  }

  private void ShowCrystal(bool show)
  {
    if (show)
      PrepareCrystal();

    if (crystal.activeSelf != show)
      crystal.SetActive(show);
  }

  private void PrepareSphere()
  {
    if (spherePrepared)
      return;

    var sphereMap = ResolveRandomSphereMaterial();
    sphereRenderer.sharedMaterial = sphereMap?.material ?? sphereMaterialCatalog.defaultMaterial;
    spherePrepared = true;
  }

  private void PrepareCrystal()
  {
    if (crystalPrepared)
      return;

    var selectedCore = ResolveCrystalTypeByDirectLinkCount(star.Data.DirectLinkCount);
    var scaleMultiplier = ResolveCrystalScaleMultiplier(selectedCore);
    crystalCore.localScale = crystalCoreBaseScale * scaleMultiplier;
    crystalPrepared = true;
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

  private void ShowBuildings(bool show)
  {
    if (show)
      PrepareBuildings();

    if (buildings.activeSelf != show)
      buildings.SetActive(show);
  }

  private void PrepareBuildings()
  {
    if (buildingsPrepared)
      return;

    var activeBuildings = star.Data.Buildings;
    if (activeBuildings.Count == 0)
    {
      buildingsPrepared = true;
      return;
    }

    float angleStep = Mathf.PI * 2f / activeBuildings.Count;
    float sphereRadius = 0.5f * sphereRenderer.transform.localScale.x;

    for (int i = 0; i < activeBuildings.Count; i++)
    {
      float baseAngle = angleStep * i;
      float offset = Rng.Range(-angleStep * 0.25f, angleStep * 0.25f);
      float angle = baseAngle + offset;

      var callout = Instantiate(
          buildingPrefab,
          buildings.transform.position,   // center of the sphere
          Quaternion.identity,
          buildings.transform);           // all the buildings' container

      callout.transform.localPosition = Vector3.zero; // root remains at the parent's center
      callout.Init(activeBuildings[i], sphereRadius, angle);
    }

    buildingsPrepared = true;
  }
}
