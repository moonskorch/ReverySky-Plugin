using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using UnityEngine;

/// <summary>
/// Object budgeting can be tuned according to map size, for example through spin.
/// Lines are sparse and semi-random, so they look bare. Lines probably should be disabled by default and enabled only near the focus.
/// Names probably should also be disabled by default and enabled only near the focus.
/// Animation is slow, and the transition freeze feels odd. A slowdown before stopping could help.
/// The hub can stick together during long line animations. With endless animation, it collapses into a clump because repulsion is too weak.
/// On live vaults, the hub sticks together noticeably, even cluster hubs.
/// A normal map looks good and space-like even on small maps, although it is less structural than Force.
/// On live maps, it sometimes looks more effective than the standard graph in terms of structure
/// (for example, the sequential rows in OneMegaHub or the continent-like structures in MMOWikiVault).
/// On a live 10K map, it is very slow, but it builds highly meaningful semantic regions and might be better than the native graph.
/// At 501 nodes, FPS is 40-55, with spin.
/// At 2K, FPS is 20-25 and feels smooth.
/// At 5K, FPS is 10-14, and lower during animation.
/// At 10K, FPS is 5-7 when static. Better than other 10K maps!
/// [Cartographer] Graph built in 61,0 ms (notes=2000, engine=StaticLinks)
/// [RecursiveHubs/v3] Construction completed placed=2250/2250, waves=75, roots=12, backboneEdges=2238, remainingRefinementPasses=105, visibleEdges=760, navigationRadius=238,7
/// [RecursiveHubs/v6] Post-build optimization edgeBudget=760, culledLongLines=0, disabledSpin=2000, disabledBillboards=0
/// [Cartographer] Graph built in 99,6 ms (notes=5000, engine=StaticLinks)
/// Overall: the best candidate for maps up to 2K. For 2K, the economy settings raise FPS enough.
/// Fine-tune the settings for a more harmonious visual result.
/// </summary>


// Evaluation:
// - Final RecursiveHubs experiment built around the v3 layout, because v3 has
//   the preferred star-map shape and low glue risk.
// - Adds v5-style independent construction/link timing.
// - Adds adaptive line budgets, long non-backbone edge pruning, and optional
//   large-graph visual throttles to target the FPS notes from v3 without
//   changing the core structural placement.
//
// Assessment:
// - Pending manual comparison against v3 on 2K/5K maps.

/// <summary>
/// RecursiveHubs v6 preserves v3's structural layout and adds final-pass
/// controls for animation duration, edge noise, and large-graph runtime cost.
/// </summary>
[DisallowMultipleComponent]
public class Engine_RecursiveHubs_v6 : Engine_RecursiveHubs_v3, ICartographerEngine
{
  private enum AnimationLifetime
  {
    Instant,
    Timed,
    Endless
  }

  private enum EdgeBudgetMode
  {
    ManualV3,
    AdaptiveByNodeCount
  }

  private enum LargeGraphVisualPolicy
  {
    PreserveVisuals,
    DisableSpin,
    DisableSpinAndBillboards
  }

  [Header("v6 Construction Timing")]
  [SerializeField] private AnimationLifetime constructionLifetime = AnimationLifetime.Timed;
  [Tooltip("Used when constructionLifetime is Timed. 0 means instant construction.")]
  [SerializeField, Min(0f)] private float constructionAnimationSeconds = 2.5f;
  [Tooltip("Used when constructionLifetime is Endless. Construction still completes, but at this intentionally slow rate.")]
  [SerializeField, Range(1, 4096)] private int endlessConstructionNodesPerFrame = 120;
  [SerializeField, Range(1, 16)] private int constructionBatchesPerFrameV6 = 1;
  [SerializeField, Range(1f, 120f)] private float timingFrameRate = 30f;

  [Header("v6 Link Timing")]
  [SerializeField] private AnimationLifetime linkRefinementLifetime = AnimationLifetime.Timed;
  [Tooltip("Used when linkRefinementLifetime is Timed. 0 computes the configured passes immediately.")]
  [SerializeField, Min(0f)] private float linkRefinementSeconds = 3.5f;
  [Tooltip("How many refinement passes to run immediately when link animation is Instant.")]
  [SerializeField, Range(0, 512)] private int instantLinkRefinementPasses = 24;
  [Tooltip("How many refinement passes to run per frame while link refinement is animated.")]
  [SerializeField, Range(1, 12)] private int linkRefinementPassesPerFrameV6 = 1;
  [Tooltip("Warmup passes before the endless spring loop continues forever.")]
  [SerializeField, Range(0, 512)] private int endlessLinkWarmupPasses = 24;
  [Tooltip("Continuous mode keeps RequiresTick true and keeps applying refinement passes.")]
  [SerializeField] private bool keepLinksAliveForever;

  [Header("v6 Line LOD")]
  [SerializeField] private EdgeBudgetMode edgeBudgetMode = EdgeBudgetMode.AdaptiveByNodeCount;
  [SerializeField, Range(0, 3000)] private int manualVisibleEdges = 900;
  [SerializeField, Range(0, 3000)] private int smallGraphVisibleEdges = 420;
  [SerializeField, Range(100, 3000)] private int smallGraphNodeThreshold = 700;
  [SerializeField, Range(0, 3000)] private int minimumVisibleEdges = 260;
  [SerializeField, Range(0, 3000)] private int maximumVisibleEdges = 1100;
  [SerializeField, Range(0f, 2f)] private float visibleEdgesPerNode = 0.38f;
  [SerializeField, Range(0f, 1f)] private float backboneBudgetRatioV6 = 0.58f;
  [SerializeField, Range(0f, 1f)] private float directLinkBudgetRatioV6 = 0.30f;
  [SerializeField, Min(1f)] private float tagEdgeRestLengthMultiplierV6 = 2.15f;
  [SerializeField] private bool pruneLongNonBackboneEdges = true;
  [SerializeField, Min(1f)] private float nonBackboneMaxRestLengthMultiplier = 3.0f;

  [Header("v6 Large Graph Visual Cost")]
  [SerializeField] private LargeGraphVisualPolicy largeGraphVisualPolicy = LargeGraphVisualPolicy.DisableSpin;
  [SerializeField, Range(100, 20000)] private int largeGraphVisualThreshold = 1600;
  [SerializeField] private bool logOptimizationSummary = true;

  private const BindingFlags PrivateInstance =
    BindingFlags.Instance | BindingFlags.NonPublic;
  private const BindingFlags AnyInstance =
    BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

  private static readonly FieldInfo AnimateConstructionField =
    FindField("animateConstruction");
  private static readonly FieldInfo NodesPerConstructionFrameField =
    FindField("nodesPerConstructionFrame");
  private static readonly FieldInfo ConstructionBatchesPerFrameField =
    FindField("constructionBatchesPerFrame");
  private static readonly FieldInfo AnimateRefinementField =
    FindField("animateRefinement");
  private static readonly FieldInfo RefinementPassesField =
    FindField("refinementPasses");
  private static readonly FieldInfo RefinementPassesPerFrameField =
    FindField("refinementPassesPerFrame");
  private static readonly FieldInfo MaxVisibleEdgesField =
    FindField("maxVisibleEdges");
  private static readonly FieldInfo BackboneBudgetRatioField =
    FindField("backboneBudgetRatio");
  private static readonly FieldInfo DirectLinkBudgetRatioField =
    FindField("directLinkBudgetRatio");
  private static readonly FieldInfo MaxVisibleTagEdgeRestMultiplierField =
    FindField("maxVisibleTagEdgeRestMultiplier");
  private static readonly FieldInfo DirectLinkRestLengthField =
    FindField("directLinkRestLength");
  private static readonly FieldInfo NoteTagRestLengthField =
    FindField("noteTagRestLength");
  private static readonly FieldInfo LayoutParentField =
    FindField("layoutParent");
  private static readonly FieldInfo NodesField =
    FindField("_nodes");
  private static readonly FieldInfo LineBindingsField =
    FindField("_lineBindings");
  private static readonly FieldInfo BackboneEdgesField =
    FindField("_backboneEdges");
  private static readonly FieldInfo LinesInstantiatedField =
    FindField("_linesInstantiated");

  private static readonly MethodInfo RunRefinementPassMethod =
    FindMethod("RunRefinementPass");
  private static readonly MethodInfo UpdateVisualPositionsMethod =
    FindMethod("UpdateVisualPositions");
  private static readonly MethodInfo UpdateLinePositionsMethod =
    FindMethod("UpdateLinePositions");
  private static readonly MethodInfo UpdateNavigationBoundsMethod =
    FindMethod("UpdateNavigationBounds");

  private bool _continuousLinkRefinement;
  private bool _graphHasNodes;
  private bool _postBuildOptimized;
  private int _lastResolvedEdgeBudget;

  public new bool RequiresTick =>
    base.RequiresTick ||
    (_continuousLinkRefinement && _graphHasNodes);

  public new void BuildGraph(List<NoteData> notes)
  {
    _continuousLinkRefinement = false;
    _postBuildOptimized = false;
    _graphHasNodes = notes != null && notes.Count > 0;

    int noteCount = notes?.Count ?? 0;
    ConfigureLineBudgetBeforeBuild(noteCount);
    ConfigureLinkTimingBeforeBuild();
    ConfigureConstructionTimingBeforeBuild(noteCount);

    base.BuildGraph(notes);

    ConfigureConstructionTimingAfterBuild();
    _continuousLinkRefinement =
      _graphHasNodes &&
      linkRefinementLifetime == AnimationLifetime.Endless &&
      keepLinksAliveForever;

    TryApplyPostBuildOptimizations();
  }

  public new void Tick(float dt)
  {
    if (base.RequiresTick)
    {
      base.Tick(dt);
      TryApplyPostBuildOptimizations();
      return;
    }

    if (_continuousLinkRefinement && _graphHasNodes && AreLinesInstantiated())
    {
      int passCount = Mathf.Max(1, linkRefinementPassesPerFrameV6);
      for (int i = 0; i < passCount; i++)
        InvokePrivate(RunRefinementPassMethod);

      InvokePrivate(UpdateVisualPositionsMethod);
      InvokePrivate(UpdateLinePositionsMethod);
      InvokePrivate(UpdateNavigationBoundsMethod);
    }

    TryApplyPostBuildOptimizations();
  }

  private void ConfigureLineBudgetBeforeBuild(int noteCount)
  {
    _lastResolvedEdgeBudget = ResolveEdgeBudget(noteCount);

    SetPrivateField(MaxVisibleEdgesField, _lastResolvedEdgeBudget);
    SetPrivateField(BackboneBudgetRatioField, Mathf.Clamp01(backboneBudgetRatioV6));
    SetPrivateField(DirectLinkBudgetRatioField, Mathf.Clamp01(directLinkBudgetRatioV6));
    SetPrivateField(
      MaxVisibleTagEdgeRestMultiplierField,
      Mathf.Max(1f, tagEdgeRestLengthMultiplierV6));
  }

  private int ResolveEdgeBudget(int noteCount)
  {
    if (edgeBudgetMode == EdgeBudgetMode.ManualV3)
      return Mathf.Max(0, manualVisibleEdges);

    int safeNoteCount = Mathf.Max(0, noteCount);
    if (safeNoteCount > 0 && safeNoteCount <= smallGraphNodeThreshold)
      return Mathf.Max(0, smallGraphVisibleEdges);

    int adaptiveBudget = Mathf.RoundToInt(safeNoteCount * Mathf.Max(0f, visibleEdgesPerNode));
    int lowerBound = Mathf.Min(minimumVisibleEdges, maximumVisibleEdges);
    int upperBound = Mathf.Max(minimumVisibleEdges, maximumVisibleEdges);
    return Mathf.Clamp(adaptiveBudget, lowerBound, upperBound);
  }

  private void ConfigureConstructionTimingBeforeBuild(int noteCount)
  {
    int safeBatches = Mathf.Max(1, constructionBatchesPerFrameV6);
    SetPrivateField(ConstructionBatchesPerFrameField, safeBatches);

    bool animate =
      constructionLifetime != AnimationLifetime.Instant &&
      constructionAnimationSeconds > 0f;

    if (constructionLifetime == AnimationLifetime.Endless)
      animate = true;

    SetPrivateField(AnimateConstructionField, animate);

    int estimatedNodes = Mathf.Max(1, noteCount);
    SetPrivateField(
      NodesPerConstructionFrameField,
      ResolveConstructionNodesPerFrame(estimatedNodes));
  }

  private void ConfigureConstructionTimingAfterBuild()
  {
    int actualNodes = GetPrivateNodeCount();
    if (actualNodes <= 0)
      return;

    SetPrivateField(
      NodesPerConstructionFrameField,
      ResolveConstructionNodesPerFrame(actualNodes));
  }

  private int ResolveConstructionNodesPerFrame(int nodeCount)
  {
    if (constructionLifetime == AnimationLifetime.Endless)
      return Mathf.Max(1, endlessConstructionNodesPerFrame);

    if (constructionLifetime == AnimationLifetime.Instant ||
        constructionAnimationSeconds <= 0f)
    {
      return Mathf.Max(1, nodeCount);
    }

    float frames =
      Mathf.Max(1f, constructionAnimationSeconds * Mathf.Max(1f, timingFrameRate));
    return Mathf.Max(1, Mathf.CeilToInt(nodeCount / frames));
  }

  private void ConfigureLinkTimingBeforeBuild()
  {
    int safePassesPerFrame = Mathf.Max(1, linkRefinementPassesPerFrameV6);
    SetPrivateField(RefinementPassesPerFrameField, safePassesPerFrame);

    switch (linkRefinementLifetime)
    {
      case AnimationLifetime.Instant:
        SetPrivateField(AnimateRefinementField, false);
        SetPrivateField(RefinementPassesField, Mathf.Max(0, instantLinkRefinementPasses));
        break;

      case AnimationLifetime.Endless:
        SetPrivateField(AnimateRefinementField, true);
        SetPrivateField(RefinementPassesField, Mathf.Max(0, endlessLinkWarmupPasses));
        break;

      case AnimationLifetime.Timed:
      default:
        if (linkRefinementSeconds <= 0f)
        {
          SetPrivateField(AnimateRefinementField, false);
          SetPrivateField(RefinementPassesField, Mathf.Max(0, instantLinkRefinementPasses));
          break;
        }

        float frames =
          Mathf.Max(1f, linkRefinementSeconds * Mathf.Max(1f, timingFrameRate));
        int passes = Mathf.CeilToInt(frames * safePassesPerFrame);
        SetPrivateField(AnimateRefinementField, true);
        SetPrivateField(RefinementPassesField, Mathf.Max(1, passes));
        break;
    }
  }

  private void TryApplyPostBuildOptimizations()
  {
    if (_postBuildOptimized || !_graphHasNodes || !AreLinesInstantiated())
      return;

    int culledLines = pruneLongNonBackboneEdges
      ? PruneLongNonBackboneLines()
      : 0;

    int disabledSpin = 0;
    int disabledBillboards = 0;
    if (GetPrivateNodeCount() >= largeGraphVisualThreshold)
      ApplyLargeGraphVisualPolicy(out disabledSpin, out disabledBillboards);

    _postBuildOptimized = true;

    if (logOptimizationSummary)
    {
      UnityEngine.Debug.Log(
        $"[RecursiveHubs/v6] Post-build optimization edgeBudget={_lastResolvedEdgeBudget}, " +
        $"culledLongLines={culledLines}, disabledSpin={disabledSpin}, " +
        $"disabledBillboards={disabledBillboards}");
    }
  }

  private int PruneLongNonBackboneLines()
  {
    if (LineBindingsField?.GetValue(this) is not IList lineBindings ||
        NodesField?.GetValue(this) is not IList nodes)
    {
      return 0;
    }

    var backbonePairs = BuildBackbonePairSet();
    float maxLength = ResolveMaxNonBackboneLineLength();
    float maxLengthSqr = maxLength * maxLength;
    int removed = 0;

    for (int i = lineBindings.Count - 1; i >= 0; i--)
    {
      object binding = lineBindings[i];
      if (!TryReadLineBinding(binding, out var line, out int a, out int b))
        continue;

      if (line == null)
      {
        lineBindings.RemoveAt(i);
        continue;
      }

      long pairKey = PairKey(Mathf.Min(a, b), Mathf.Max(a, b));
      if (backbonePairs.Contains(pairKey))
        continue;

      if (!TryReadNodeLocalPosition(nodes, a, out var aPosition) ||
          !TryReadNodeLocalPosition(nodes, b, out var bPosition))
      {
        continue;
      }

      if ((bPosition - aPosition).sqrMagnitude <= maxLengthSqr)
        continue;

      Destroy(line.gameObject);
      lineBindings.RemoveAt(i);
      removed++;
    }

    return removed;
  }

  private HashSet<long> BuildBackbonePairSet()
  {
    var pairs = new HashSet<long>();
    if (BackboneEdgesField?.GetValue(this) is not IEnumerable backboneEdges)
      return pairs;

    foreach (object edge in backboneEdges)
    {
      if (!TryReadEdgeEndpoints(edge, out int a, out int b))
        continue;

      pairs.Add(PairKey(Mathf.Min(a, b), Mathf.Max(a, b)));
    }

    return pairs;
  }

  private float ResolveMaxNonBackboneLineLength()
  {
    float directRestLength = ReadPrivateFloat(DirectLinkRestLengthField, 7.2f);
    float noteTagRestLength = ReadPrivateFloat(NoteTagRestLengthField, 8.6f);
    return Mathf.Max(directRestLength, noteTagRestLength) *
      Mathf.Max(1f, nonBackboneMaxRestLengthMultiplier);
  }

  private void ApplyLargeGraphVisualPolicy(
    out int disabledSpin,
    out int disabledBillboards)
  {
    disabledSpin = 0;
    disabledBillboards = 0;

    if (largeGraphVisualPolicy == LargeGraphVisualPolicy.PreserveVisuals)
      return;

    Transform root = LayoutParentField?.GetValue(this) as Transform;
    if (root == null)
      return;

    var spinComponents = root.GetComponentsInChildren<Spin>(true);
    for (int i = 0; i < spinComponents.Length; i++)
    {
      if (!spinComponents[i].enabled)
        continue;

      spinComponents[i].enabled = false;
      disabledSpin++;
    }

    if (largeGraphVisualPolicy != LargeGraphVisualPolicy.DisableSpinAndBillboards)
      return;

    var billboardComponents = root.GetComponentsInChildren<LookAtCamera>(true);
    for (int i = 0; i < billboardComponents.Length; i++)
    {
      if (!billboardComponents[i].enabled)
        continue;

      billboardComponents[i].enabled = false;
      disabledBillboards++;
    }
  }

  private int GetPrivateNodeCount()
  {
    if (NodesField?.GetValue(this) is ICollection collection)
      return collection.Count;

    return 0;
  }

  private bool AreLinesInstantiated()
  {
    return LinesInstantiatedField?.GetValue(this) is bool value && value;
  }

  private static bool TryReadLineBinding(
    object binding,
    out LineRenderer line,
    out int a,
    out int b)
  {
    line = null;
    a = 0;
    b = 0;

    if (binding == null)
      return false;

    var type = binding.GetType();
    line = type.GetField("Line", AnyInstance)?.GetValue(binding) as LineRenderer;
    object aValue = type.GetField("A", AnyInstance)?.GetValue(binding);
    object bValue = type.GetField("B", AnyInstance)?.GetValue(binding);

    if (aValue is not int aIndex || bValue is not int bIndex)
      return false;

    a = aIndex;
    b = bIndex;
    return true;
  }

  private static bool TryReadEdgeEndpoints(object edge, out int a, out int b)
  {
    a = 0;
    b = 0;

    if (edge == null)
      return false;

    var type = edge.GetType();
    object aValue = type.GetField("A", AnyInstance)?.GetValue(edge);
    object bValue = type.GetField("B", AnyInstance)?.GetValue(edge);

    if (aValue is not int aIndex || bValue is not int bIndex)
      return false;

    a = aIndex;
    b = bIndex;
    return true;
  }

  private static bool TryReadNodeLocalPosition(
    IList nodes,
    int nodeIndex,
    out Vector3 position)
  {
    position = Vector3.zero;
    if (nodeIndex < 0 || nodeIndex >= nodes.Count)
      return false;

    object node = nodes[nodeIndex];
    object value = node?.GetType()
      .GetField("LocalPosition", AnyInstance)
      ?.GetValue(node);

    if (value is not Vector3 localPosition)
      return false;

    position = localPosition;
    return true;
  }

  private float ReadPrivateFloat(FieldInfo field, float fallback)
  {
    return field?.GetValue(this) is float value ? value : fallback;
  }

  private static FieldInfo FindField(string fieldName)
  {
    return typeof(Engine_RecursiveHubs_v3).GetField(fieldName, PrivateInstance);
  }

  private static MethodInfo FindMethod(string methodName)
  {
    return typeof(Engine_RecursiveHubs_v3).GetMethod(methodName, PrivateInstance);
  }

  private void SetPrivateField(FieldInfo field, object value)
  {
    field?.SetValue(this, value);
  }

  private void InvokePrivate(MethodInfo method)
  {
    method?.Invoke(this, null);
  }

  private static long PairKey(int a, int b)
  {
    return ((long)(uint)a << 32) | (uint)b;
  }
}
