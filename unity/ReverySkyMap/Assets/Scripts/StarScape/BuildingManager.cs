using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Pool;

public sealed class BuildingManager : MonoBehaviour
{
  private sealed class StarBuildings
  {
    public readonly List<BuildingCallout> Callouts = new();
    public LabelHighlightState HighlightState;

    public bool Focused => HighlightState == LabelHighlightState.Focused;
  }

  public static BuildingManager I { get; private set; }

  [SerializeField] private BuildingCallout buildingPrefab;
  [SerializeField, Range(0, 10000)] private int calloutBudget = 256;

  private readonly Dictionary<StarVisual, StarBuildings> buildingsByStar = new();
  private ObjectPool<BuildingCallout> calloutPool;
  private int usedCalloutBudget;

  private static bool CanRefillBuildings => Cartographer.I.CurrentView == ScapeView.Buildings;

  private void Awake()
  {
    if (I != null) 
      Debug.LogError("More than one instance of BuildingManager");
    I = this;

    // Focused stars may exceed the non-focused budget by up to one full callout set.
    int poolSize = calloutBudget + buildingPrefab.DirectionSlotCount;
    calloutPool = new ObjectPool<BuildingCallout>(
      CreateCallout,
      null,
      callout => callout.PrepareForPool(transform),
      callout => Destroy(callout.gameObject),
      collectionCheck: false,
      defaultCapacity: poolSize,
      maxSize: poolSize);
  }

  private void OnDestroy()
  {
    if (I == this)
      I = null;
  }

  public void Clear()
  {
    ReleaseAllBuildings();
    calloutPool.Clear();
    buildingsByStar.Clear();
    usedCalloutBudget = 0;
  }

  public void Register(StarVisual visual, bool wantsVisible, LabelHighlightState highlightState)
  {
    if (visual == null)
      return;

    if (!buildingsByStar.TryGetValue(visual, out var starBuildings))
    {
      if (!wantsVisible)
        return;

      starBuildings = new StarBuildings();
      buildingsByStar[visual] = starBuildings;
    }

    if (!wantsVisible)
    {
      RemoveStarBuildings(visual, starBuildings);
      RefillAvailableBuildings();
      return;
    }

    int budgetBefore = usedCalloutBudget;
    bool wasFocused = starBuildings.Focused;
    bool willBeFocused = highlightState == LabelHighlightState.Focused;
    if (wasFocused && !willBeFocused)
      ReleaseBuildings(starBuildings);
    else if (!wasFocused && willBeFocused)
      usedCalloutBudget -= starBuildings.Callouts.Count;

    starBuildings.HighlightState = highlightState;
    UpdateStarBuildings(visual, starBuildings, allowFocusedOverflow: starBuildings.Focused);
    if (usedCalloutBudget < budgetBefore)
      RefillAvailableBuildings();
  }

  public void Refresh(StarVisual visual)
  {
    if (visual == null || !buildingsByStar.TryGetValue(visual, out var starBuildings))
      return;

    ReleaseBuildings(starBuildings);
    UpdateStarBuildings(visual, starBuildings, allowFocusedOverflow: starBuildings.Focused);
    RefillAvailableBuildings();
  }

  private void UpdateStarBuildings(StarVisual visual, StarBuildings starBuildings, bool allowFocusedOverflow)
  {
    IReadOnlyList<BuildingData> buildings = visual.BuildingData;
    int buildingCount = ResolveCalloutCount(buildings);
    if (buildingCount <= 0)
    {
      RemoveStarBuildings(visual, starBuildings);
      return;
    }

    int targetCount = ResolveTargetBuildingCount(buildingCount, starBuildings, allowFocusedOverflow);

    if (targetCount <= 0)
    {
      ReleaseBuildings(starBuildings);
      return;
    }

    if (starBuildings.Callouts.Count == targetCount)
    {
      // Same-count reuse is only for visibility/highlight resyncs.
      // Buildings are rebuilt through Refresh().
      ApplyHighlight(starBuildings);
      return;
    }

    RebuildBuildings(visual, starBuildings, buildings, targetCount);
  }

  private int ResolveCalloutCount(IReadOnlyList<BuildingData> buildings)
    => Mathf.Min(buildings?.Count ?? 0, buildingPrefab.DirectionSlotCount);

  private int ResolveTargetBuildingCount(
    int buildingCount,
    StarBuildings starBuildings,
    bool allowFocusedOverflow)
  {
    if (allowFocusedOverflow)
      return buildingCount;

    int availableCount = calloutBudget - usedCalloutBudget;
    availableCount += starBuildings.Callouts.Count;

    return availableCount >= buildingCount ? buildingCount : 0;
  }

  private void RemoveStarBuildings(StarVisual visual, StarBuildings starBuildings)
  {
    ReleaseBuildings(starBuildings);
    buildingsByStar.Remove(visual);
  }

  private void RebuildBuildings(
    StarVisual visual,
    StarBuildings starBuildings,
    IReadOnlyList<BuildingData> buildings,
    int targetCount)
  {
    ReleaseBuildings(starBuildings);

    int slotCount = buildingPrefab.DirectionSlotCount;
    var occupiedSlots = new bool[slotCount];
    for (int i = 0; i < targetCount; i++)
    {
      BuildingCallout callout = calloutPool.Get();
      BuildingData building = buildings[i];
      int preferredSlot = BuildingCallout.ResolvePreferredSlot(building.Name, slotCount);
      int resolvedSlot = BuildingCallout.ResolveAvailableSlot(preferredSlot, occupiedSlots);
      occupiedSlots[resolvedSlot] = true;

      callout.PrepareForUse(visual.BuildingRoot);
      callout.Init(building, visual.BuildingSphereRadius, resolvedSlot);
      callout.ApplyHighlight(starBuildings.HighlightState);
      starBuildings.Callouts.Add(callout);
      callout.Activate();
    }

    if (!starBuildings.Focused)
      usedCalloutBudget += targetCount;
  }

  private void RefillAvailableBuildings()
  {
    if (!CanRefillBuildings || usedCalloutBudget >= calloutBudget)
      return;

    foreach (var pair in buildingsByStar)
    {
      if (usedCalloutBudget >= calloutBudget)
        return;

      StarVisual visual = pair.Key;
      StarBuildings starBuildings = pair.Value;
      int buildingCount = ResolveCalloutCount(visual.BuildingData);
      if (buildingCount <= 0 ||
          starBuildings.Focused ||
          starBuildings.Callouts.Count >= buildingCount)
      {
        continue;
      }

      UpdateStarBuildings(visual, starBuildings, allowFocusedOverflow: false);
    }
  }

  private static void ApplyHighlight(StarBuildings starBuildings)
  {
    for (int i = 0; i < starBuildings.Callouts.Count; i++)
      starBuildings.Callouts[i]?.ApplyHighlight(starBuildings.HighlightState);
  }

  private void ReleaseBuildings(StarBuildings starBuildings)
  {
    if (!starBuildings.Focused)
      usedCalloutBudget -= starBuildings.Callouts.Count;

    for (int i = 0; i < starBuildings.Callouts.Count; i++)
    {
      BuildingCallout callout = starBuildings.Callouts[i];
      calloutPool.Release(callout);
    }

    starBuildings.Callouts.Clear();
  }

  private BuildingCallout CreateCallout()
  {
    BuildingCallout callout = Instantiate(buildingPrefab, transform);
    callout.gameObject.SetActive(false);
    return callout;
  }

  private void ReleaseAllBuildings()
  {
    foreach (var pair in buildingsByStar)
      ReleaseBuildings(pair.Value);
  }
}
