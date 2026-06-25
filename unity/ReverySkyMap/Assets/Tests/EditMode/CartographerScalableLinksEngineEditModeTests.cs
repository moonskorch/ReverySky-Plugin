using System;
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

  private static EngineScope CreateEngineScope(
    IReadOnlyList<NoteData> notes,
    IReadOnlyList<MapRuntimeContext.RuntimeNoteLink> links)
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
    scope.Engine.BuildGraph(runtimeNotes);
    return scope;
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
      SetPrivateField("edgePrefab", null);
      SetPrivateField("constructionLifetime", ParseNestedEnum("AnimationLifetime", "Instant"));
      SetPrivateField("linkRefinementLifetime", ParseNestedEnum("AnimationLifetime", "Instant"));
      SetPrivateField("constructionAnimationSeconds", 0f);
      SetPrivateField("linkRefinementPasses", 24);
      SetPrivateField("keepLinksAliveForever", false);
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
