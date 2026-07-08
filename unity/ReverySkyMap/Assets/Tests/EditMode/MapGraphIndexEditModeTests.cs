using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

public class MapGraphIndexEditModeTests
{
  private readonly List<GameObject> createdObjects = new();

  [TearDown]
  public void TearDown()
  {
    for (int i = 0; i < createdObjects.Count; i++)
    {
      if (createdObjects[i] != null)
        Object.DestroyImmediate(createdObjects[i]);
    }

    createdObjects.Clear();
  }

  [Test]
  public void Build_RepresentsStarsTagsEdgesAndAdjacency()
  {
    Star noteA = CreateStar("a", 7, 7);
    Star noteB = CreateStar("b");
    TagNode tag = CreateTag(7);

    var links = new List<MapRuntimeContext.RuntimeNoteLink>
    {
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "a", TargetId = "b", Weight = 2f },
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "b", TargetId = "a", Weight = 3f }
    };

    MapGraphIndex index = MapGraphIndex.Build(
      new List<Star> { noteA, noteB },
      new List<TagNode> { tag },
      links);

    Assert.That(index.Nodes.Count, Is.EqualTo(3));
    Assert.That(index.Edges.Count, Is.EqualTo(2));
    Assert.That(index.TryGetStar("a", out var resolvedStar), Is.True);
    Assert.That(resolvedStar, Is.SameAs(noteA));
    Assert.That(index.TryGetTagNode(7, out var resolvedTag), Is.True);
    Assert.That(resolvedTag, Is.SameAs(tag));
    Assert.That(index.TryGetNodeId(noteA, out var noteAId), Is.True);
    Assert.That(index.TryGetNodeIdByNoteId("b", out var noteBId), Is.True);
    Assert.That(index.TryGetNodeIdByTagId(7, out var tagId), Is.True);

    IReadOnlyList<MapGraphNodeId> noteANeighbors = index.GetNeighborIds(noteAId);
    IReadOnlyList<MapGraphNodeId> noteBNeighbors = index.GetNeighborIds(noteBId);
    IReadOnlyList<MapGraphNodeId> tagNeighbors = index.GetNeighborIds(tagId);

    Assert.That(noteANeighbors.Count, Is.EqualTo(2));
    Assert.That(noteANeighbors, Does.Contain(noteBId));
    Assert.That(noteANeighbors, Does.Contain(tagId));
    Assert.That(noteBNeighbors, Is.EquivalentTo(new[] { noteAId }));
    Assert.That(tagNeighbors, Is.EquivalentTo(new[] { noteAId }));
    Assert.That(index.GetIncidentEdges(noteAId).Count, Is.EqualTo(2));
  }

  [Test]
  public void Build_SkipsInvalidMissingSelfAndDuplicateEntries()
  {
    Star noteA = CreateStar("a", 7, 7);
    Star duplicateNoteA = CreateStar("a", 8);
    Star noteB = CreateStar("b");
    Star blankNote = CreateStar(string.Empty);
    TagNode tag = CreateTag(7);
    TagNode duplicateTag = CreateTag(7);

    var links = new List<MapRuntimeContext.RuntimeNoteLink>
    {
      null,
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "a", TargetId = "a", Weight = 1f },
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "a", TargetId = "missing", Weight = 1f },
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "a", TargetId = "b", Weight = 1f },
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "b", TargetId = "a", Weight = 1f },
      new MapRuntimeContext.RuntimeNoteLink { SourceId = string.Empty, TargetId = "b", Weight = 1f }
    };

    MapGraphIndex index = MapGraphIndex.Build(
      new List<Star> { null, noteA, duplicateNoteA, noteB, blankNote },
      new List<TagNode> { null, tag, duplicateTag },
      links);

    Assert.That(index.Nodes.Count, Is.EqualTo(3));
    Assert.That(index.Edges.Count, Is.EqualTo(2));
    Assert.That(index.TryGetNodeId(duplicateNoteA, out _), Is.False);
    Assert.That(index.TryGetNodeId(blankNote, out _), Is.False);
    Assert.That(index.TryGetNodeId(duplicateTag, out _), Is.False);
    Assert.That(index.TryGetNodeIdByNoteId("missing", out _), Is.False);
  }

  private Star CreateStar(string noteId, params int[] tagIds)
  {
    var gameObject = new GameObject($"MapGraphIndexEditModeTests_Star_{noteId}");
    createdObjects.Add(gameObject);
    var star = gameObject.AddComponent<Star>();
    star.SetData(new NoteData
    {
      Id = noteId,
      TagIds = new List<int>(tagIds)
    });
    return star;
  }

  private TagNode CreateTag(int tagId)
  {
    var gameObject = new GameObject($"MapGraphIndexEditModeTests_Tag_{tagId}");
    createdObjects.Add(gameObject);
    var tag = gameObject.AddComponent<TagNode>();
    tag.UserTagId = tagId;
    return tag;
  }
}
