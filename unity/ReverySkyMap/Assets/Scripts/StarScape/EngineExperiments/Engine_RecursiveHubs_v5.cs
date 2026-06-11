using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using UnityEngine;

/// <summary>
/// Continuous line animation pulls the map into a clump; repulsion is absent or too weak.
/// </summary>


// Evaluation:
// - Experimental animation-control wrapper for Engine_RecursiveHubs_v3.
// - Purpose: keep v3's structural layout, but separate construction animation
//   timing from link refinement timing.
// - Construction can be instant, spread over a target duration, or deliberately
//   slow. Link refinement can be computed immediately, animated for a duration,
//   or kept alive as a continuous low-amplitude spring pass.
//
// Assessment:
// - Pending manual FPS/feel evaluation.

/// <summary>
/// RecursiveHubs v5 keeps v3's layout logic and adds independent animation
/// timing controls for node construction and post-placement link refinement.
/// </summary>
[DisallowMultipleComponent]
public class Engine_RecursiveHubs_v5 : Engine_RecursiveHubs_v3, ICartographerEngine
{
  private enum AnimationLifetime
  {
    Instant,
    Timed,
    Endless
  }

  [Header("v5 Construction Timing")]
  [SerializeField] private AnimationLifetime constructionLifetime = AnimationLifetime.Timed;
  [Tooltip("Used when constructionLifetime is Timed. 0 means instant construction.")]
  [SerializeField, Min(0f)] private float constructionAnimationSeconds = 3f;
  [Tooltip("Used when constructionLifetime is Endless. Construction still completes, but at this intentionally slow rate.")]
  [SerializeField, Range(1, 4096)] private int endlessConstructionNodesPerFrame = 120;
  [SerializeField, Range(1, 16)] private int constructionBatchesPerFrameV5 = 1;
  [SerializeField, Range(1f, 120f)] private float timingFrameRate = 30f;

  [Header("v5 Link Timing")]
  [SerializeField] private AnimationLifetime linkRefinementLifetime = AnimationLifetime.Timed;
  [Tooltip("Used when linkRefinementLifetime is Timed. 0 computes the configured passes immediately.")]
  [SerializeField, Min(0f)] private float linkRefinementSeconds = 4f;
  [Tooltip("How many refinement passes to run immediately when link animation is Instant.")]
  [SerializeField, Range(0, 512)] private int instantLinkRefinementPasses = 24;
  [Tooltip("How many refinement passes to run per frame while link refinement is animated.")]
  [SerializeField, Range(1, 12)] private int linkRefinementPassesPerFrameV5 = 1;
  [Tooltip("Warmup passes before the endless low-amplitude spring loop continues forever.")]
  [SerializeField, Range(0, 512)] private int endlessLinkWarmupPasses = 24;
  [Tooltip("Continuous mode keeps RequiresTick true and keeps applying refinement passes.")]
  [SerializeField] private bool keepLinksAliveForever = true;

  private const BindingFlags PrivateInstance =
    BindingFlags.Instance | BindingFlags.NonPublic;

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
  private static readonly FieldInfo NodesField =
    FindField("_nodes");
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

  public new bool RequiresTick =>
    base.RequiresTick ||
    (_continuousLinkRefinement && _graphHasNodes);

  public new void BuildGraph(List<NoteData> notes)
  {
    _continuousLinkRefinement = false;
    _graphHasNodes = notes != null && notes.Count > 0;

    ConfigureLinkTimingBeforeBuild();
    ConfigureConstructionTimingBeforeBuild(notes?.Count ?? 0);

    base.BuildGraph(notes);

    ConfigureConstructionTimingAfterBuild();
    _continuousLinkRefinement =
      _graphHasNodes &&
      linkRefinementLifetime == AnimationLifetime.Endless &&
      keepLinksAliveForever;
  }

  public new void Tick(float dt)
  {
    if (base.RequiresTick)
    {
      base.Tick(dt);
      return;
    }

    if (!_continuousLinkRefinement || !_graphHasNodes || !AreLinesInstantiated())
      return;

    int passCount = Mathf.Max(1, linkRefinementPassesPerFrameV5);
    for (int i = 0; i < passCount; i++)
      RunPrivateRefinementPass();

    InvokePrivate(UpdateVisualPositionsMethod);
    InvokePrivate(UpdateLinePositionsMethod);
    InvokePrivate(UpdateNavigationBoundsMethod);
  }

  private void ConfigureConstructionTimingBeforeBuild(int noteCount)
  {
    int safeBatches = Mathf.Max(1, constructionBatchesPerFrameV5);
    SetPrivateField(ConstructionBatchesPerFrameField, safeBatches);

    bool animate =
      constructionLifetime != AnimationLifetime.Instant &&
      constructionAnimationSeconds > 0f;

    if (constructionLifetime == AnimationLifetime.Endless)
      animate = true;

    SetPrivateField(AnimateConstructionField, animate);

    int estimatedNodes = Mathf.Max(1, noteCount);
    int nodesPerFrame = ResolveConstructionNodesPerFrame(estimatedNodes);
    SetPrivateField(NodesPerConstructionFrameField, nodesPerFrame);
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

    float frames = Mathf.Max(1f, constructionAnimationSeconds * Mathf.Max(1f, timingFrameRate));
    return Mathf.Max(1, Mathf.CeilToInt(nodeCount / frames));
  }

  private void ConfigureLinkTimingBeforeBuild()
  {
    int safePassesPerFrame = Mathf.Max(1, linkRefinementPassesPerFrameV5);
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

        float frames = Mathf.Max(1f, linkRefinementSeconds * Mathf.Max(1f, timingFrameRate));
        int passes = Mathf.CeilToInt(frames * safePassesPerFrame);
        SetPrivateField(AnimateRefinementField, true);
        SetPrivateField(RefinementPassesField, Mathf.Max(1, passes));
        break;
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

  private void RunPrivateRefinementPass()
  {
    InvokePrivate(RunRefinementPassMethod);
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
}
