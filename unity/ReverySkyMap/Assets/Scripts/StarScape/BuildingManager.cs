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
  [SerializeField, Range(0, 10000)] private int maxActiveCallouts = 256;

  private readonly Dictionary<StarVisual, StarBuildings> buildingsByStar = new();
  private ObjectPool<BuildingCallout> calloutPool;
  private int activeCalloutCount;

  public int ActiveCalloutCount => activeCalloutCount;
  private static bool CanRefillBuildings => Cartographer.I.CurrentView == ScapeView.Buildings;

  private void Awake()
  {
    if (I != null) 
      Debug.LogError("More than one instance of BuildingManager");
    I = this;

    // Focused stars may exceed the non-focused budget by up to one full callout set.
    int poolSize = maxActiveCallouts + buildingPrefab.DirectionSlotCount;
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
    activeCalloutCount = 0;
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

    starBuildings.HighlightState = highlightState;

    if (!wantsVisible)
    {
      RemoveStarBuildings(visual, starBuildings);
      RefillAvailableBuildings();
      return;
    }

    UpdateStarBuildings(visual, starBuildings, allowFocusedOverflow: starBuildings.Focused);
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
    int buildingCount = buildings?.Count ?? 0;
    if (buildingCount <= 0)
    {
      RemoveStarBuildings(visual, starBuildings);
      return;
    }

    int targetCount = ResolveTargetBuildingCount(buildingCount, starBuildings, allowFocusedOverflow);

    if (CanReuseBuildings(starBuildings, buildingCount, targetCount, allowFocusedOverflow))
    {
      ApplyHighlight(starBuildings);
      return;
    }

    if (targetCount <= 0)
    {
      ReleaseBuildings(starBuildings);
      return;
    }

    RebuildBuildings(visual, starBuildings, buildings, targetCount);
  }

  private int ResolveTargetBuildingCount(
    int buildingCount,
    StarBuildings starBuildings,
    bool allowFocusedOverflow)
  {
    if (allowFocusedOverflow)
      return buildingCount;

    int availableCount = maxActiveCallouts - activeCalloutCount + starBuildings.Callouts.Count;
    return Mathf.Min(buildingCount, availableCount);
  }

  private static bool CanReuseBuildings(
    StarBuildings starBuildings,
    int buildingCount,
    int targetCount,
    bool allowFocusedOverflow)
  {
    int currentCount = starBuildings.Callouts.Count;
    if (currentCount <= 0)
      return false;

    if (currentCount == targetCount)
      return true;

    if (!allowFocusedOverflow && targetCount <= currentCount && currentCount <= buildingCount)
      return true;

    return false;
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
      activeCalloutCount++;
      BuildingData building = buildings[i];
      int preferredSlot = BuildingCallout.ResolvePreferredSlot(building.Name, slotCount);
      int resolvedSlot = BuildingCallout.ResolveAvailableSlot(preferredSlot, occupiedSlots);
      occupiedSlots[resolvedSlot] = true;

      callout.PrepareForUse(visual.BuildingRoot);
      callout.Init(building, visual.BuildingSphereRadius, resolvedSlot);
      callout.ApplyHighlight(starBuildings.HighlightState);
      starBuildings.Callouts.Add(callout);
    }
  }

  private void RefillAvailableBuildings()
  {
    if (!CanRefillBuildings || activeCalloutCount >= maxActiveCallouts)
      return;

    foreach (var pair in buildingsByStar)
    {
      if (activeCalloutCount >= maxActiveCallouts)
        return;

      StarVisual visual = pair.Key;
      StarBuildings starBuildings = pair.Value;
      int buildingCount = visual.BuildingData?.Count ?? 0;
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
    for (int i = 0; i < starBuildings.Callouts.Count; i++)
    {
      BuildingCallout callout = starBuildings.Callouts[i];
      calloutPool.Release(callout);
      activeCalloutCount = Mathf.Max(0, activeCalloutCount - 1);
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
