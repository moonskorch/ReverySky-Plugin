using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;

public class CartographerScalableLinksEngineEditModeTests
{
  [Test]
  public void Engine_ExposesScalableLinksContract()
  {
    using var scope = CreateEngineScope(new List<NoteData>(), new List<MapRuntimeContext.RuntimeNoteLink>());

    Assert.That(scope.Engine.EngineType, Is.EqualTo(MapLayoutMode.ScalableLinks));
    Assert.That(scope.Engine.RequiresTick, Is.False);
    Assert.That(scope.Engine.ScapeWarper, Is.Null);
  }

  [Test]
  public void BuildGraph_SameInputs_GiveSameBoundRadius()
  {
    var notes = BuildTaglessNotes(200);
    var links = new List<MapRuntimeContext.RuntimeNoteLink>();

    using var first = CreateEngineScope(notes, links);
    using var second = CreateEngineScope(BuildTaglessNotes(200), links);

    Assert.That(first.Engine.BoundRadius, Is.EqualTo(second.Engine.BoundRadius));
  }

  [Test]
  public void BuildGraph_MoreNodes_GrowBoundRadius()
  {
    using var small = CreateEngineScope(BuildTaglessNotes(50), new List<MapRuntimeContext.RuntimeNoteLink>());
    using var large = CreateEngineScope(BuildTaglessNotes(1000), new List<MapRuntimeContext.RuntimeNoteLink>());

    Assert.That(large.Engine.BoundRadius, Is.GreaterThan(small.Engine.BoundRadius));
  }

  [Test]
  public void BuildGraph_ZeroOrNegativeInputs_AreNormalizedSafely()
  {
    using var scope = CreateEngineScope(new List<NoteData>(), new List<MapRuntimeContext.RuntimeNoteLink>());

    Assert.That(scope.Engine.BoundRadius, Is.GreaterThan(0f));
    Assert.That(float.IsNaN(scope.Engine.BoundRadius), Is.False);
    Assert.That(float.IsInfinity(scope.Engine.BoundRadius), Is.False);
  }

  [Test]
  public void BuildGraph_MultipleComponents_StayFiniteAndCreateAllStars()
  {
    var singleComponent = BuildTaglessComponentsGraph(10000);
    var fourComponents = BuildTaglessComponentsGraph(2500, 2500, 2500, 2500);

    using var one = CreateEngineScope(singleComponent.Notes, singleComponent.Links);
    using var four = CreateEngineScope(fourComponents.Notes, fourComponents.Links);

    Assert.That(one.Engine.Stars, Has.Count.EqualTo(10000));
    Assert.That(four.Engine.Stars, Has.Count.EqualTo(10000));
    Assert.That(one.Engine.BoundRadius, Is.GreaterThan(0f));
    Assert.That(four.Engine.BoundRadius, Is.GreaterThan(0f));
    Assert.That(float.IsNaN(one.Engine.BoundRadius), Is.False);
    Assert.That(float.IsNaN(four.Engine.BoundRadius), Is.False);
    Assert.That(float.IsInfinity(one.Engine.BoundRadius), Is.False);
    Assert.That(float.IsInfinity(four.Engine.BoundRadius), Is.False);
  }

  [Test]
  public void BuildGraph_TimedLinkRefinement_EventuallyStopsTicking()
  {
    using var scope = CreateEngineScope(
      BuildTaglessNotes(16),
      new List<MapRuntimeContext.RuntimeNoteLink>(),
      engineScope =>
      {
        engineScope.SetAnimationLifetime("linkRefinementLifetime", "Timed");
        engineScope.SetPrivateFieldForTest("linkRefinementPasses", 2);
        engineScope.SetPrivateFieldForTest("refinementFinishTaperFraction", 0f);
        engineScope.SetPrivateFieldForTest("refinementPassesPerFrame", 1);
      });

    Assert.That(scope.Engine.RequiresTick, Is.True);

    for (int i = 0; i < 4 && scope.Engine.RequiresTick; i++)
      scope.Engine.Tick(1f / 30f);

    Assert.That(scope.Engine.RequiresTick, Is.False);
  }

  [Test]
  public void BuildGraph_EndlessLinkRefinement_KeepsTickingAfterFinitePasses()
  {
    var graph = BuildTaglessComponentsGraph(16);
    using var scope = CreateEngineScope(
      graph.Notes,
      graph.Links,
      engineScope =>
      {
        engineScope.SetAnimationLifetime("linkRefinementLifetime", "Endless");
        engineScope.SetPrivateFieldForTest("linkRefinementPasses", 2);
        engineScope.SetPrivateFieldForTest("refinementFinishTaperFraction", 0f);
        engineScope.SetPrivateFieldForTest("refinementPassesPerFrame", 1);
      });

    Assert.That(scope.Engine.RequiresTick, Is.True);

    for (int i = 0; i < 4; i++)
      scope.Engine.Tick(1f / 30f);

    Assert.That(scope.Engine.RequiresTick, Is.True);
  }

  [Test]
  public void BuildGraph_TimedLinkRefinementTaper_ResolvesExtraPasses()
  {
    using var scope = CreateEngineScope(
      BuildTaglessNotes(16),
      new List<MapRuntimeContext.RuntimeNoteLink>(),
      engineScope =>
      {
        engineScope.SetAnimationLifetime("linkRefinementLifetime", "Timed");
        engineScope.SetPrivateFieldForTest("linkRefinementPasses", 10);
        engineScope.SetPrivateFieldForTest("refinementFinishTaperFraction", 0.4f);
        engineScope.SetPrivateFieldForTest("refinementPassesPerFrame", 1);
      });

    TickUntilStopped(scope);

    Assert.That(scope.GetPrivateFieldForTest<int>("_resolvedLinkRefinementPasses"), Is.EqualTo(13));
    Assert.That(scope.GetPrivateFieldForTest<int>("_resolvedLinkRefinementTaperPasses"), Is.EqualTo(5));
    Assert.That(scope.GetPrivateFieldForTest<int>("_completedRefinementPasses"), Is.EqualTo(13));
    Assert.That(scope.GetPrivateFieldForTest<int>("_remainingRefinementPasses"), Is.EqualTo(0));
    Assert.That(scope.Engine.RequiresTick, Is.False);
  }

  [Test]
  public void BuildGraph_TimedLinkRefinementTaperDisabled_KeepsRawPassCount()
  {
    using var scope = CreateEngineScope(
      BuildTaglessNotes(16),
      new List<MapRuntimeContext.RuntimeNoteLink>(),
      engineScope =>
      {
        engineScope.SetAnimationLifetime("linkRefinementLifetime", "Timed");
        engineScope.SetPrivateFieldForTest("linkRefinementPasses", 10);
        engineScope.SetPrivateFieldForTest("refinementFinishTaperFraction", 0f);
        engineScope.SetPrivateFieldForTest("refinementPassesPerFrame", 1);
      });

    TickUntilStopped(scope);

    Assert.That(scope.GetPrivateFieldForTest<int>("_resolvedLinkRefinementPasses"), Is.EqualTo(10));
    Assert.That(scope.GetPrivateFieldForTest<int>("_resolvedLinkRefinementTaperPasses"), Is.EqualTo(0));
    Assert.That(scope.GetPrivateFieldForTest<int>("_completedRefinementPasses"), Is.EqualTo(10));
  }

  [Test]
  public void BuildGraph_InstantLinkRefinementTaper_DoesNotExpandPassCount()
  {
    using var scope = CreateEngineScope(
      BuildTaglessNotes(16),
      new List<MapRuntimeContext.RuntimeNoteLink>(),
      engineScope =>
      {
        engineScope.SetAnimationLifetime("linkRefinementLifetime", "Instant");
        engineScope.SetPrivateFieldForTest("linkRefinementPasses", 10);
        engineScope.SetPrivateFieldForTest("refinementFinishTaperFraction", 0.4f);
      });

    Assert.That(scope.Engine.RequiresTick, Is.False);
    Assert.That(scope.GetPrivateFieldForTest<int>("_resolvedLinkRefinementPasses"), Is.EqualTo(10));
    Assert.That(scope.GetPrivateFieldForTest<int>("_resolvedLinkRefinementTaperPasses"), Is.EqualTo(0));
    Assert.That(scope.GetPrivateFieldForTest<int>("_completedRefinementPasses"), Is.EqualTo(10));
  }

  [Test]
  public void BuildGraph_EndlessLinkRefinementTaper_DoesNotExpandFinitePassCount()
  {
    using var scope = CreateEngineScope(
      BuildTaglessNotes(16),
      new List<MapRuntimeContext.RuntimeNoteLink>(),
      engineScope =>
      {
        engineScope.SetAnimationLifetime("linkRefinementLifetime", "Endless");
        engineScope.SetPrivateFieldForTest("linkRefinementPasses", 10);
        engineScope.SetPrivateFieldForTest("refinementFinishTaperFraction", 0.4f);
      });

    Assert.That(scope.GetPrivateFieldForTest<int>("_resolvedLinkRefinementPasses"), Is.EqualTo(10));
    Assert.That(scope.GetPrivateFieldForTest<int>("_resolvedLinkRefinementTaperPasses"), Is.EqualTo(0));
    Assert.That(scope.Engine.RequiresTick, Is.True);
  }

  [Test]
  public void BuildGraph_TimedConstructionUsesLayoutOriginPivot()
  {
    var graph = BuildTaglessComponentsGraph(64);
    using var scope = CreateEngineScope(
      graph.Notes,
      graph.Links,
      engineScope =>
      {
        engineScope.SetAnimationLifetime("constructionLifetime", "Timed");
        engineScope.SetPrivateFieldForTest("constructionAnimationSeconds", 5f);
        engineScope.SetAnimationLifetime("linkRefinementLifetime", "Timed");
        engineScope.SetPrivateFieldForTest("linkRefinementPasses", 4);
        engineScope.SetPrivateFieldForTest("refinementFinishTaperFraction", 0f);
        engineScope.SetPrivateFieldForTest("refinementPassesPerFrame", 1);
      });

    Vector3 initialPivot = scope.Engine.Pivot;
    Assert.That(initialPivot, Is.EqualTo(scope.Engine.transform.position));

    Assert.That(scope.Engine.RequiresTick, Is.True);

    TickUntilStopped(scope);

    Vector3 finalPivot = scope.Engine.Pivot;
    Assert.That(finalPivot, Is.EqualTo(scope.Engine.transform.position));
    Assert.That(finalPivot.x, Is.EqualTo(initialPivot.x).Within(0.0001f));
    Assert.That(finalPivot.y, Is.EqualTo(initialPivot.y).Within(0.0001f));
    Assert.That(finalPivot.z, Is.EqualTo(initialPivot.z).Within(0.0001f));
    Assert.That(scope.Engine.BoundRadius, Is.GreaterThan(0f));
    Assert.That(float.IsNaN(scope.Engine.BoundRadius), Is.False);
    Assert.That(float.IsInfinity(scope.Engine.BoundRadius), Is.False);
  }

  [Test]
  public void TimedRefinementSmoothing_ContinuesVisualMotionAfterFinalPass()
  {
    var graph = BuildTaglessComponentsGraph(2);
    int graphReadyCount = 0;
    Action<string> onGraphReady = _ => graphReadyCount++;
    MapRuntimeContext.OnGraphReady += onGraphReady;

    try
    {
      using var scope = CreateEngineScope(
        graph.Notes,
        graph.Links,
        engineScope =>
        {
          engineScope.SetAnimationLifetime("linkRefinementLifetime", "Timed");
          engineScope.SetPrivateFieldForTest("linkRefinementPasses", 2);
          engineScope.SetPrivateFieldForTest("refinementFinishTaperFraction", 0f);
          engineScope.SetPrivateFieldForTest("refinementPassesPerFrame", 1);
          engineScope.SetPrivateFieldForTest("nodeSpacingPassesPerRefinement", 0);
          engineScope.SetPrivateFieldForTest("rootMobility", 1f);
          engineScope.SetPrivateFieldForTest("linkPull", 1f);
          engineScope.SetPrivateFieldForTest("maxMovePerPass", 1f);
          engineScope.SetPrivateFieldForTest("visualSmoothingSeconds", 0.3f);
        });

      SetNodeLocalPosition(scope, 0, Vector3.zero);
      SetNodeLocalPosition(scope, 1, new Vector3(30f, 0f, 0f));
      scope.InvokePrivateMethodForTest("UpdateVisualPositions");

      scope.Engine.Tick(1f / 30f);

      Vector3 firstVisualPosition = scope.Engine.Stars[0].transform.position;
      Vector3 firstTargetPosition = GetNodeLocalPosition(scope, 0);

      Assert.That(scope.GetPrivateFieldForTest<int>("_remainingRefinementPasses"), Is.EqualTo(1));
      Assert.That(Vector3.Distance(firstVisualPosition, firstTargetPosition), Is.GreaterThan(0.001f));
      Assert.That(graphReadyCount, Is.EqualTo(0));

      scope.Engine.Tick(1f / 30f);

      Vector3 finalTargetPosition = GetNodeLocalPosition(scope, 0);
      Vector3 secondVisualPosition = scope.Engine.Stars[0].transform.position;
      Assert.That(scope.GetPrivateFieldForTest<int>("_remainingRefinementPasses"), Is.EqualTo(0));
      Assert.That(scope.Engine.RequiresTick, Is.True);
      Assert.That(Vector3.Distance(secondVisualPosition, finalTargetPosition), Is.GreaterThan(0.001f));
      Assert.That(graphReadyCount, Is.EqualTo(0));

      TickUntilStopped(scope);

      Assert.That(scope.Engine.Stars[0].transform.position.x, Is.EqualTo(finalTargetPosition.x).Within(0.0001f));
      Assert.That(scope.Engine.Stars[0].transform.position.y, Is.EqualTo(finalTargetPosition.y).Within(0.0001f));
      Assert.That(scope.Engine.Stars[0].transform.position.z, Is.EqualTo(finalTargetPosition.z).Within(0.0001f));
      Assert.That(scope.Engine.RequiresTick, Is.False);
      Assert.That(graphReadyCount, Is.EqualTo(1));
    }
    finally
    {
      MapRuntimeContext.OnGraphReady -= onGraphReady;
    }
  }

  [Test]
  public void TimedRefinementSmoothing_DoesNotChangeCalculatedLocalPositions()
  {
    var graph = BuildTaglessComponentsGraph(24);
    using var unsmoothed = CreateEngineScope(
      graph.Notes,
      graph.Links,
      engineScope =>
      {
        engineScope.SetAnimationLifetime("linkRefinementLifetime", "Timed");
        engineScope.SetPrivateFieldForTest("linkRefinementPasses", 6);
        engineScope.SetPrivateFieldForTest("refinementFinishTaperFraction", 0f);
        engineScope.SetPrivateFieldForTest("refinementPassesPerFrame", 1);
        engineScope.SetPrivateFieldForTest("visualSmoothingSeconds", 0f);
      });
    using var smoothed = CreateEngineScope(
      graph.Notes,
      graph.Links,
      engineScope =>
      {
        engineScope.SetAnimationLifetime("linkRefinementLifetime", "Timed");
        engineScope.SetPrivateFieldForTest("linkRefinementPasses", 6);
        engineScope.SetPrivateFieldForTest("refinementFinishTaperFraction", 0f);
        engineScope.SetPrivateFieldForTest("refinementPassesPerFrame", 1);
        engineScope.SetPrivateFieldForTest("visualSmoothingSeconds", 0.3f);
      });

    TickUntilStopped(unsmoothed);
    TickUntilStopped(smoothed);

    AssertNodeLocalPositionsEqual(unsmoothed, smoothed, graph.Notes.Count);
  }

  [Test]
  public void NodeSpacing_SeparatesOverlappingUnlinkedNodesToHardRadius()
  {
    using var scope = CreateEngineScope(
      BuildTaglessNotes(2),
      new List<MapRuntimeContext.RuntimeNoteLink>(),
      engineScope =>
      {
        engineScope.SetPrivateFieldForTest("linkRefinementPasses", 0);
        engineScope.SetPrivateFieldForTest("hardNodeSpacingRadius", 1f);
        engineScope.SetPrivateFieldForTest("airNodeSpacingRadius", 3f);
        engineScope.SetPrivateFieldForTest("nodeSpacingProjectionStrength", 1f);
        engineScope.SetPrivateFieldForTest("closeNeighborBudget", 1);
        engineScope.SetPrivateFieldForTest("maxNodeSpacingChecksPerNode", 0);
      });

    SetNodeLocalPosition(scope, 0, Vector3.zero);
    SetNodeLocalPosition(scope, 1, Vector3.zero);

    scope.InvokePrivateMethodForTest("ApplyNodeSpacingPass");

    float distance = Vector3.Distance(
      GetNodeLocalPosition(scope, 0),
      GetNodeLocalPosition(scope, 1));

    Assert.That(distance, Is.EqualTo(2f).Within(0.0001f));
  }

  [Test]
  public void NodeSpacing_ZeroPasses_DisablesConstraint()
  {
    using var scope = CreateEngineScope(
      BuildTaglessNotes(2),
      new List<MapRuntimeContext.RuntimeNoteLink>(),
      engineScope =>
      {
        engineScope.SetPrivateFieldForTest("linkRefinementPasses", 0);
        engineScope.SetPrivateFieldForTest("nodeSpacingPassesPerRefinement", 0);
        engineScope.SetPrivateFieldForTest("hardNodeSpacingRadius", 1f);
      });

    SetNodeLocalPosition(scope, 0, Vector3.zero);
    SetNodeLocalPosition(scope, 1, Vector3.zero);

    scope.InvokePrivateMethodForTest("RunRefinementPass");

    float distance = Vector3.Distance(
      GetNodeLocalPosition(scope, 0),
      GetNodeLocalPosition(scope, 1));

    Assert.That(distance, Is.EqualTo(0f).Within(0.0001f));
  }

  [Test]
  public void NodeSpacing_CloseNeighborBudget_AllowsLimitedPairsInsideAirRadius()
  {
    using var allowed = CreateEngineScope(
      BuildTaglessNotes(2),
      new List<MapRuntimeContext.RuntimeNoteLink>(),
      engineScope =>
      {
        engineScope.SetPrivateFieldForTest("linkRefinementPasses", 0);
        engineScope.SetPrivateFieldForTest("hardNodeSpacingRadius", 1f);
        engineScope.SetPrivateFieldForTest("airNodeSpacingRadius", 3f);
        engineScope.SetPrivateFieldForTest("nodeSpacingProjectionStrength", 1f);
        engineScope.SetPrivateFieldForTest("closeNeighborBudget", 1);
        engineScope.SetPrivateFieldForTest("maxNodeSpacingChecksPerNode", 0);
      });

    SetNodeLocalPosition(allowed, 0, Vector3.zero);
    SetNodeLocalPosition(allowed, 1, new Vector3(4f, 0f, 0f));
    allowed.InvokePrivateMethodForTest("ApplyNodeSpacingPass");

    float allowedDistance = Vector3.Distance(
      GetNodeLocalPosition(allowed, 0),
      GetNodeLocalPosition(allowed, 1));

    using var exhausted = CreateEngineScope(
      BuildTaglessNotes(2),
      new List<MapRuntimeContext.RuntimeNoteLink>(),
      engineScope =>
      {
        engineScope.SetPrivateFieldForTest("linkRefinementPasses", 0);
        engineScope.SetPrivateFieldForTest("hardNodeSpacingRadius", 1f);
        engineScope.SetPrivateFieldForTest("airNodeSpacingRadius", 3f);
        engineScope.SetPrivateFieldForTest("nodeSpacingProjectionStrength", 1f);
        engineScope.SetPrivateFieldForTest("closeNeighborBudget", 0);
        engineScope.SetPrivateFieldForTest("maxNodeSpacingChecksPerNode", 0);
      });

    SetNodeLocalPosition(exhausted, 0, Vector3.zero);
    SetNodeLocalPosition(exhausted, 1, new Vector3(4f, 0f, 0f));
    exhausted.InvokePrivateMethodForTest("ApplyNodeSpacingPass");

    float exhaustedDistance = Vector3.Distance(
      GetNodeLocalPosition(exhausted, 0),
      GetNodeLocalPosition(exhausted, 1));

    Assert.That(allowedDistance, Is.EqualTo(4f).Within(0.0001f));
    Assert.That(exhaustedDistance, Is.EqualTo(6f).Within(0.0001f));
  }

  [Test]
  public void NodeSpacing_CheckCap_BoundsDenseLocalWork()
  {
    using var scope = CreateEngineScope(
      BuildTaglessNotes(64),
      new List<MapRuntimeContext.RuntimeNoteLink>(),
      engineScope =>
      {
        engineScope.SetPrivateFieldForTest("linkRefinementPasses", 0);
        engineScope.SetPrivateFieldForTest("hardNodeSpacingRadius", 1f);
        engineScope.SetPrivateFieldForTest("nodeSpacingProjectionStrength", 1f);
        engineScope.SetPrivateFieldForTest("maxNodeSpacingChecksPerNode", 1);
      });

    for (int i = 0; i < 64; i++)
      SetNodeLocalPosition(scope, i, Vector3.zero);

    scope.SetPrivateFieldForTest("_nodeSpacingPairChecks", 0L);
    scope.InvokePrivateMethodForTest("ApplyNodeSpacingPass");

    long pairChecks = scope.GetPrivateFieldForTest<long>("_nodeSpacingPairChecks");
    Assert.That(pairChecks, Is.LessThanOrEqualTo(64));

    for (int i = 0; i < 64; i++)
      AssertFinite(GetNodeLocalPosition(scope, i));
  }

  private static EngineScope CreateEngineScope(
    IReadOnlyList<NoteData> notes,
    IReadOnlyList<MapRuntimeContext.RuntimeNoteLink> links,
    Action<EngineScope> configureBeforeBuild = null)
  {
    var runtimeNotes = notes != null
      ? new List<NoteData>(notes)
      : new List<NoteData>();
    var runtimeLinks = links != null
      ? new List<MapRuntimeContext.RuntimeNoteLink>(links)
      : new List<MapRuntimeContext.RuntimeNoteLink>();

    MapRuntimeContext.SetTagNames(new Dictionary<int, string>());
    MapRuntimeContext.SetLinks(runtimeLinks);
    MapRuntimeContext.SetNotes(runtimeNotes);

    var scope = new EngineScope(CreateStarTemplatePrefab());
    scope.ConfigureForDeterministicEditMode();
    configureBeforeBuild?.Invoke(scope);
    scope.Engine.ClearGraph();
    scope.Engine.BuildGraph(runtimeNotes);
    return scope;
  }

  private static void TickUntilStopped(EngineScope scope, int maxTicks = 512)
  {
    for (int i = 0; i < maxTicks && scope.Engine.RequiresTick; i++)
      scope.Engine.Tick(1f / 30f);

    Assert.That(scope.Engine.RequiresTick, Is.False);
  }

  private static void SetNodeLocalPosition(EngineScope scope, int nodeIndex, Vector3 position)
  {
    object node = GetNode(scope, nodeIndex);
    FieldInfo positionField = node.GetType().GetField("LocalPosition", BindingFlags.Instance | BindingFlags.Public);
    Assert.That(positionField, Is.Not.Null, "Node LocalPosition field was not found.");
    positionField.SetValue(node, position);
  }

  private static Vector3 GetNodeLocalPosition(EngineScope scope, int nodeIndex)
  {
    object node = GetNode(scope, nodeIndex);
    FieldInfo positionField = node.GetType().GetField("LocalPosition", BindingFlags.Instance | BindingFlags.Public);
    Assert.That(positionField, Is.Not.Null, "Node LocalPosition field was not found.");
    return (Vector3)positionField.GetValue(node);
  }

  private static object GetNode(EngineScope scope, int nodeIndex)
  {
    var nodes = scope.GetPrivateFieldForTest<IList>("_nodes");
    Assert.That(nodes, Has.Count.GreaterThan(nodeIndex));
    return nodes[nodeIndex];
  }

  private static void AssertNodeLocalPositionsEqual(EngineScope expected, EngineScope actual, int count)
  {
    for (int i = 0; i < count; i++)
    {
      Vector3 expectedPosition = GetNodeLocalPosition(expected, i);
      Vector3 actualPosition = GetNodeLocalPosition(actual, i);
      Assert.That(actualPosition.x, Is.EqualTo(expectedPosition.x).Within(0.0001f));
      Assert.That(actualPosition.y, Is.EqualTo(expectedPosition.y).Within(0.0001f));
      Assert.That(actualPosition.z, Is.EqualTo(expectedPosition.z).Within(0.0001f));
    }
  }

  private static void AssertFinite(Vector3 position)
  {
    Assert.That(float.IsNaN(position.x), Is.False);
    Assert.That(float.IsNaN(position.y), Is.False);
    Assert.That(float.IsNaN(position.z), Is.False);
    Assert.That(float.IsInfinity(position.x), Is.False);
    Assert.That(float.IsInfinity(position.y), Is.False);
    Assert.That(float.IsInfinity(position.z), Is.False);
  }

  private static List<NoteData> BuildTaglessNotes(int count)
  {
    var notes = new List<NoteData>(Math.Max(0, count));
    for (int i = 0; i < count; i++)
    {
      string id = $"n{i}";
      notes.Add(new NoteData
      {
        Id = id,
        Name = $"Note {i}",
        Path = $"notes/{id}.md",
        Length = 100 + i,
        TagIds = new List<int>()
      });
    }

    return notes;
  }

  private static GraphData BuildTaglessComponentsGraph(params int[] componentSizes)
  {
    var notes = new List<NoteData>();
    var links = new List<MapRuntimeContext.RuntimeNoteLink>();
    int globalIndex = 0;

    for (int componentIndex = 0; componentIndex < componentSizes.Length; componentIndex++)
    {
      int componentSize = Mathf.Max(0, componentSizes[componentIndex]);
      var componentNoteIds = new List<string>(componentSize);

      for (int i = 0; i < componentSize; i++)
      {
        string id = $"c{componentIndex}_n{globalIndex++}";
        notes.Add(new NoteData
        {
          Id = id,
          Name = $"Note {id}",
          Path = $"notes/{id}.md",
          Length = 100 + globalIndex,
          TagIds = new List<int>()
        });
        componentNoteIds.Add(id);
      }

      for (int i = 0; i < componentNoteIds.Count - 1; i++)
      {
        links.Add(new MapRuntimeContext.RuntimeNoteLink
        {
          SourceId = componentNoteIds[i],
          TargetId = componentNoteIds[i + 1],
          Weight = 1f
        });
      }
    }

    return new GraphData(notes, links);
  }

  private static StarSO CreateStarTemplatePrefab()
  {
    var template = ScriptableObject.CreateInstance<StarSO>();
    var prefab = new GameObject("CartographerScalableLinksEngineTestStarPrefab");
    prefab.AddComponent<Star>();

    FieldInfo prefabField = typeof(StarSO).GetField("prefab", BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(prefabField, Is.Not.Null, "StarSO prefab field was not found.");
    prefabField.SetValue(template, prefab);

    return template;
  }

  private sealed class EngineScope : IDisposable
  {
    private readonly GameObject engineObject;
    private readonly GameObject starPrefab;
    private readonly StarSO starTemplate;

    public EngineScope(StarSO template)
    {
      starTemplate = template;
      engineObject = new GameObject("CartographerScalableLinksEngineEditModeTests");
      Engine = engineObject.AddComponent<CartographerEngineRecursiveHubsEngine>();

      FieldInfo prefabField = typeof(StarSO).GetField("prefab", BindingFlags.Instance | BindingFlags.NonPublic);
      starPrefab = (GameObject)prefabField.GetValue(template);
    }

    public CartographerEngineRecursiveHubsEngine Engine { get; }

    public void ConfigureForDeterministicEditMode()
    {
      SetPrivateField("starTemplate", starTemplate);
      SetPrivateField("layoutParent", engineObject.transform);
      SetPrivateField("tagNodeTemplate", null);
      SetPrivateField("constructionLifetime", ParseNestedEnum("AnimationLifetime", "Instant"));
      SetPrivateField("linkRefinementLifetime", ParseNestedEnum("AnimationLifetime", "Instant"));
      SetPrivateField("constructionAnimationSeconds", 0f);
      SetPrivateField("linkRefinementPasses", 24);
    }

    public void SetAnimationLifetime(string fieldName, string value)
    {
      SetPrivateField(fieldName, ParseNestedEnum("AnimationLifetime", value));
    }

    public void SetPrivateFieldForTest(string fieldName, object value)
    {
      SetPrivateField(fieldName, value);
    }

    public T GetPrivateFieldForTest<T>(string fieldName)
    {
      FieldInfo field = typeof(CartographerEngineRecursiveHubsEngine).GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic);
      Assert.That(field, Is.Not.Null, $"Missing field {fieldName}.");
      return (T)field.GetValue(Engine);
    }

    public void InvokePrivateMethodForTest(string methodName)
    {
      MethodInfo method = typeof(CartographerEngineRecursiveHubsEngine).GetMethod(
        methodName,
        BindingFlags.Instance | BindingFlags.NonPublic,
        null,
        Type.EmptyTypes,
        null);
      Assert.That(method, Is.Not.Null, $"Missing method {methodName}.");
      method.Invoke(Engine, Array.Empty<object>());
    }

    public void Dispose()
    {
      if (engineObject != null)
        UnityEngine.Object.DestroyImmediate(engineObject);

      if (starPrefab != null)
        UnityEngine.Object.DestroyImmediate(starPrefab);

      if (starTemplate != null)
        UnityEngine.Object.DestroyImmediate(starTemplate);
    }

    private void SetPrivateField(string fieldName, object value)
    {
      FieldInfo field = typeof(CartographerEngineRecursiveHubsEngine).GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic);
      Assert.That(field, Is.Not.Null, $"Missing field {fieldName}.");
      field.SetValue(Engine, value);
    }

    private static object ParseNestedEnum(string nestedTypeName, string value)
    {
      Type nestedType = typeof(CartographerEngineRecursiveHubsEngine).GetNestedType(nestedTypeName, BindingFlags.NonPublic);
      Assert.That(nestedType, Is.Not.Null, $"Missing nested type {nestedTypeName}.");
      return Enum.Parse(nestedType, value);
    }
  }

  private sealed class GraphData
  {
    public GraphData(List<NoteData> notes, List<MapRuntimeContext.RuntimeNoteLink> links)
    {
      Notes = notes;
      Links = links;
    }

    public List<NoteData> Notes { get; }
    public List<MapRuntimeContext.RuntimeNoteLink> Links { get; }
  }
}
