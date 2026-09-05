using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class StarVisual : MonoBehaviour
{
  [SerializeField] private Star star;
  [SerializeField] private NodeVisibility visibilitySource;
  [SerializeField] private LabelPresenter titlePresenter;

  [SerializeField] private TextMeshPro nameText;
  [SerializeField] private Renderer sphereRenderer;
  [SerializeField] private Transform crystalCore;
  [SerializeField] private SphereMaterialCatalogSO sphereMaterialCatalog;
  [SerializeField] private CrystalTypeScaleMapperSO crystalScaleMapper;

  [Header("Switched sections")]
  [SerializeField] private GameObject sphere;
  [SerializeField] private GameObject crystal;
  [SerializeField] private GameObject buildings;

  private Vector3 crystalCoreBaseScale = Vector3.one;

  private bool titlePrepared;
  private bool spherePrepared;
  private bool crystalPrepared;
  private ScapeView currentView = ScapeView.Planets;

  public Transform BuildingRoot => buildings.transform;
  public float BuildingSphereRadius => 0.5f * sphereRenderer.transform.localScale.x;
  public IReadOnlyList<BuildingData> BuildingData => star.Data.Buildings;

  private void Start()
  {
    crystalCoreBaseScale = crystalCore.localScale;

    visibilitySource.OnDistanceVisibilityChanged += HandleDistanceVisibilityChanged;
    visibilitySource.OnHighlightStateChanged += HandleHighlightStateChanged;

    Cartographer.I.OnViewChanged += ApplyView;

    ApplyView(Cartographer.I.CurrentView);
  }

  private void OnDestroy()
  {
    visibilitySource.OnDistanceVisibilityChanged -= HandleDistanceVisibilityChanged;
    visibilitySource.OnHighlightStateChanged -= HandleHighlightStateChanged;
    Cartographer.I.OnViewChanged -= ApplyView;
  }

  private void ApplyView(ScapeView view)
  {
    currentView = view;

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
        currentView = ScapeView.Planets;
        SetPlanetView();
        Debug.LogWarning($"[StarVisual] Unknown view {view}, fallback to Planets.");
        return;
    }
  }

  private void SetPlanetView()
  {
    SetTitle(true);
    ShowSphere(true);
    ShowCrystal(true);
    ShowBuildings(false);
  }

  private void SetPlainView()
  {
    SetTitle(true);
    ShowSphere(true);
    ShowCrystal(false);
    ShowBuildings(false);
  }

  private void SetBuildingsView()
  {
    SetTitle(false);
    ShowSphere(true);
    ShowCrystal(false);
    SyncBuildings();
  }

  private void SetTitle(bool visible)
  {
    if (visible)
      PrepareTitle();

    titlePresenter.SetModeAllowed(visible);
  }

  private void HandleDistanceVisibilityChanged(bool visible)
  {
    if (currentView == ScapeView.Buildings)
      SyncBuildings();
  }

  private void HandleHighlightStateChanged(LabelHighlightState state)
  {
    if (currentView == ScapeView.Buildings)
      SyncBuildings();
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
    BuildingManager.I.Register(this, show, visibilitySource.HighlightState);
  }

  public void RefreshBuildings()
  {
    if (currentView != ScapeView.Buildings)
      return;

    SyncBuildings();
    BuildingManager.I.Refresh(this);
  }

  public void PlayBuildingChangeAnimation(
    StarPulseAnimator pulseAnimator,
    IReadOnlyList<string> addedBuildingNames)
  {
    pulseAnimator?.Play(transform);

    if (addedBuildingNames == null || addedBuildingNames.Count == 0)
      return;

    IReadOnlyList<BuildingCallout> callouts = BuildingManager.I.GetCallouts(this);
    for (int i = 0; i < addedBuildingNames.Count; i++)
    {
      string addedBuildingName = addedBuildingNames[i];
      for (int j = 0; j < callouts.Count; j++)
      {
        BuildingCallout callout = callouts[j];
        if (callout == null ||
            !string.Equals(callout.BuildingName, addedBuildingName, System.StringComparison.Ordinal))
        {
          continue;
        }

        callout.PlayNameReveal();
        break;
      }
    }
  }

  private void SyncBuildings()
  {
    bool focused = visibilitySource.HighlightState == LabelHighlightState.Focused;
    ShowBuildings(currentView == ScapeView.Buildings && (visibilitySource.IsDistanceVisible || focused));
  }
}
