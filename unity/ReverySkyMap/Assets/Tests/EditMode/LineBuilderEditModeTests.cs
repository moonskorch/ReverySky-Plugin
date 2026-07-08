using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.Pool;
using UnityEngine.TestTools;

public class LineBuilderEditModeTests
{
  [UnityTest]
  public IEnumerator TryCreateDistanceEntry_RegisteredNodes_ReturnEntriesForStarsAndTags()
  {
    using var scope = CreateScope();
    ConfigureStar(scope.NoteA, "n1", "notes/n1.md");
    ConfigureStar(scope.NoteB, "n2", "notes/n2.md");
    ConfigureTag(scope.Tag, 7);

    RebuildWithIndex(scope.Builder, new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode> { scope.Tag }, 4, 10);

    Assert.That(scope.Builder.TryCreateDistanceEntry(scope.NoteA, out var starEntry), Is.True);
    Assert.That(starEntry.node, Is.SameAs(scope.NoteA));
    Assert.That(starEntry.referenceTransform, Is.SameAs(scope.NoteA.transform));
    Assert.That(starEntry.consumer, Is.SameAs(scope.Builder));

    Assert.That(scope.Builder.TryCreateDistanceEntry(scope.Tag, out var tagEntry), Is.True);
    Assert.That(tagEntry.node, Is.SameAs(scope.Tag));
    Assert.That(tagEntry.referenceTransform, Is.SameAs(scope.Tag.transform));

    var rogueObject = new GameObject("RogueNode");
    var rogueStar = rogueObject.AddComponent<Star>();
    Assert.That(scope.Builder.TryCreateDistanceEntry(rogueStar, out _), Is.False);
    Object.DestroyImmediate(rogueObject);

    yield return null;
  }

  [UnityTest]
  public IEnumerator Rebuild_NoteLinks_AreDeduplicatedAndUseVisibleEndpoints()
  {
    using var scope = CreateScope();
    ConfigureStar(scope.NoteA, "n1", "notes/n1.md");
    ConfigureStar(scope.NoteB, "n2", "notes/n2.md");
    ConfigureTag(scope.Tag, 7);
    SetPosition(scope.NoteA, new Vector3(-2f, 1f, 0.5f));
    SetPosition(scope.NoteB, new Vector3(4f, 3f, -1f));

    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>
    {
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n2", Weight = 1f },
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "n2", TargetId = "n1", Weight = 1f },
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n1", Weight = 1f },
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "missing", Weight = 1f }
    });

    RebuildWithIndex(scope.Builder, new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode> { scope.Tag }, 4, 10);
    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    FlushLineBuilder(scope.Builder);
    yield return null;

    LineRenderer[] lines = scope.LineParent.GetComponentsInChildren<LineRenderer>(true);
    Assert.That(lines, Has.Length.EqualTo(1));
    Assert.That(lines[0].GetPosition(0), Is.EqualTo(scope.NoteA.transform.position));
    Assert.That(lines[0].GetPosition(1), Is.EqualTo(scope.NoteB.transform.position));
  }

  [UnityTest]
  public IEnumerator Rebuild_WithGraphIndex_UsesIndexedEdges()
  {
    using var scope = CreateScope();
    ConfigureStar(scope.NoteA, "n1", "notes/n1.md");
    ConfigureStar(scope.NoteB, "n2", "notes/n2.md");
    SetPosition(scope.NoteA, new Vector3(-2f, 0f, 0f));
    SetPosition(scope.NoteB, new Vector3(2f, 0f, 0f));

    var index = MapGraphIndex.Build(
      new List<Star> { scope.NoteA, scope.NoteB },
      new List<TagNode>(),
      new List<MapRuntimeContext.RuntimeNoteLink>
      {
        new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n2", Weight = 1f }
      });

    scope.Builder.Rebuild(index, 4, 10);
    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    FlushLineBuilder(scope.Builder);
    yield return null;

    AssertLineConnects(GetOnlyLine(scope.LineParent), scope.NoteA, scope.NoteB);
  }

  [UnityTest]
  public IEnumerator SetDistanceVisible_SharedLineReturnsToPoolAfterAllEndpointsHide()
  {
    using var scope = CreateScope();
    ConfigureStar(scope.NoteA, "n1", "notes/n1.md", 7);
    ConfigureTag(scope.Tag, 7);
    SetPosition(scope.NoteA, new Vector3(1f, 2f, 3f));
    SetPosition(scope.Tag, new Vector3(4f, 5f, 6f));

    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>());

    RebuildWithIndex(scope.Builder, new List<Star> { scope.NoteA }, new List<TagNode> { scope.Tag }, 4, 10);
    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    scope.Builder.SetDistanceVisible(scope.Tag, true);
    FlushLineBuilder(scope.Builder);
    yield return null;

    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(1));
    Assert.That(GetActiveLineCount(scope.LineParent), Is.EqualTo(1));

    scope.Builder.SetDistanceVisible(scope.NoteA, false);
    FlushLineBuilder(scope.Builder);
    yield return null;
    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(1));
    Assert.That(GetActiveLineCount(scope.LineParent), Is.EqualTo(1));

    scope.Builder.SetDistanceVisible(scope.Tag, false);
    FlushLineBuilder(scope.Builder);
    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(1));
    yield return null;
    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(1));
    Assert.That(GetActiveLineCount(scope.LineParent), Is.EqualTo(0));
  }

  [UnityTest]
  public IEnumerator SetDistanceVisible_SharedLineReturnsToPoolExactlyOnce()
  {
    using var scope = CreateScope();
    ConfigureStar(scope.NoteA, "n1", "notes/n1.md", 7);
    ConfigureTag(scope.Tag, 7);
    SetPosition(scope.NoteA, new Vector3(1f, 2f, 3f));
    SetPosition(scope.Tag, new Vector3(4f, 5f, 6f));

    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>());

    RebuildWithIndex(scope.Builder, new List<Star> { scope.NoteA }, new List<TagNode> { scope.Tag }, 4, 10);
    Assert.That(GetInactiveLineCount(scope.Builder), Is.EqualTo(0));

    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    scope.Builder.SetDistanceVisible(scope.Tag, true);
    FlushLineBuilder(scope.Builder);
    yield return null;

    Assert.That(GetInactiveLineCount(scope.Builder), Is.EqualTo(0));

    scope.Builder.SetDistanceVisible(scope.NoteA, false);
    FlushLineBuilder(scope.Builder);
    yield return null;
    Assert.That(GetInactiveLineCount(scope.Builder), Is.EqualTo(0));

    scope.Builder.SetDistanceVisible(scope.Tag, false);
    FlushLineBuilder(scope.Builder);
    Assert.That(GetInactiveLineCount(scope.Builder), Is.EqualTo(1));

    scope.Builder.SetDistanceVisible(scope.Tag, false);
    FlushLineBuilder(scope.Builder);
    Assert.That(GetInactiveLineCount(scope.Builder), Is.EqualTo(1));
  }

  [UnityTest]
  public IEnumerator SetDistanceVisible_ReusesReturnedLine()
  {
    using var scope = CreateScope();
    ConfigureStar(scope.NoteA, "n1", "notes/n1.md");
    ConfigureStar(scope.NoteB, "n2", "notes/n2.md");
    SetPosition(scope.NoteA, new Vector3(-2f, 0f, 0f));
    SetPosition(scope.NoteB, new Vector3(2f, 0f, 0f));

    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>
    {
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n2", Weight = 1f }
    });

    RebuildWithIndex(scope.Builder, new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode>(), 1, 10);
    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    FlushLineBuilder(scope.Builder);
    yield return null;

    LineRenderer firstLine = GetOnlyLine(scope.LineParent);
    Assert.That(firstLine.gameObject.activeSelf, Is.True);

    scope.Builder.SetDistanceVisible(scope.NoteA, false);
    FlushLineBuilder(scope.Builder);
    yield return null;
    Assert.That(firstLine.gameObject.activeSelf, Is.False);

    scope.Builder.SetDistanceVisible(scope.NoteB, true);
    FlushLineBuilder(scope.Builder);
    yield return null;

    LineRenderer reusedLine = GetOnlyLine(scope.LineParent);
    Assert.That(reusedLine, Is.SameAs(firstLine));
    Assert.That(reusedLine.gameObject.activeSelf, Is.True);
  }

  [UnityTest]
  public IEnumerator SetLinesVisible_TogglesRenderersWithoutReturningLinesToPool()
  {
    using var scope = CreateScope();
    ConfigureStar(scope.NoteA, "n1", "notes/n1.md");
    ConfigureStar(scope.NoteB, "n2", "notes/n2.md");

    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>
    {
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n2", Weight = 1f }
    });

    RebuildWithIndex(scope.Builder, new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode>(), 1, 10);
    scope.Builder.SetLinesVisible(false);
    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    FlushLineBuilder(scope.Builder);
    yield return null;

    LineRenderer line = GetOnlyActiveLine(scope.LineParent);
    Assert.That(line.enabled, Is.False);
    Assert.That(GetInactiveLineCount(scope.Builder), Is.EqualTo(0));

    scope.Builder.SetLinesVisible(true);
    Assert.That(line.gameObject.activeSelf, Is.True);
    Assert.That(line.enabled, Is.True);

    scope.Builder.SetLinesVisible(false);
    Assert.That(line.gameObject.activeSelf, Is.True);
    Assert.That(line.enabled, Is.False);
  }

  [UnityTest]
  public IEnumerator Rebuild_ZeroActiveLineLimit_DisposesPooledLines()
  {
    using var scope = CreateScope();
    ConfigureStar(scope.NoteA, "n1", "notes/n1.md");
    ConfigureStar(scope.NoteB, "n2", "notes/n2.md");

    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>
    {
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n2", Weight = 1f }
    });

    RebuildWithIndex(scope.Builder, new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode>(), 1, 10);
    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    FlushLineBuilder(scope.Builder);
    yield return null;
    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(1));

    scope.Builder.SetDistanceVisible(scope.NoteA, false);
    FlushLineBuilder(scope.Builder);
    yield return null;
    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(1));

    RebuildWithIndex(scope.Builder, new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode>(), 0, 10);
    yield return null;

    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(0));
  }

  [UnityTest]
  public IEnumerator Rebuild_SmallerActiveLineLimit_RecreatesSmallerPool()
  {
    using var scope = CreateScope();
    ConfigureStar(scope.NoteA, "n1", "notes/n1.md", 7);
    ConfigureStar(scope.NoteB, "n2", "notes/n2.md");
    ConfigureTag(scope.Tag, 7);

    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>
    {
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n2", Weight = 1f }
    });

    RebuildWithIndex(scope.Builder, new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode> { scope.Tag }, 2, 10);
    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    FlushLineBuilder(scope.Builder);
    yield return null;
    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(2));

    scope.Builder.SetDistanceVisible(scope.NoteA, false);
    FlushLineBuilder(scope.Builder);
    yield return null;
    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(2));
    Assert.That(GetActiveLineCount(scope.LineParent), Is.EqualTo(0));

    RebuildWithIndex(scope.Builder, new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode> { scope.Tag }, 1, 10);
    yield return null;
    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(0));

    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    FlushLineBuilder(scope.Builder);
    yield return null;
    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(1));
  }

  [UnityTest]
  public IEnumerator Rebuild_ActiveLineLimit_CapsCreatedLines()
  {
    using var scope = CreateScope();
    ConfigureStar(scope.NoteA, "n1", "notes/n1.md", 7);
    ConfigureStar(scope.NoteB, "n2", "notes/n2.md");
    ConfigureTag(scope.Tag, 7);
    SetPosition(scope.NoteA, new Vector3(-1f, 0f, 0f));
    SetPosition(scope.NoteB, new Vector3(1f, 0f, 0f));
    SetPosition(scope.Tag, new Vector3(0f, 2f, 0f));

    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>
    {
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n2", Weight = 1f }
    });

    RebuildWithIndex(scope.Builder, new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode> { scope.Tag }, 1, 10);
    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    scope.Builder.SetDistanceVisible(scope.NoteB, true);
    scope.Builder.SetDistanceVisible(scope.Tag, true);
    FlushLineBuilder(scope.Builder);
    yield return null;

    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(1));
  }

  [UnityTest]
  public IEnumerator Rebuild_PerNodeLineLimit_CapsHubLines()
  {
    using var scope = CreateScope();
    var leafObjects = new List<GameObject>();
    var stars = new List<Star> { scope.NoteA };
    var links = new List<MapRuntimeContext.RuntimeNoteLink>();

    try
    {
      ConfigureStar(scope.NoteA, "hub", "notes/hub.md");
      SetPosition(scope.NoteA, Vector3.zero);

      for (int i = 0; i < 60; i++)
      {
        var leafObject = new GameObject($"LineBuilderEditModeTests_Leaf_{i}");
        var leaf = leafObject.AddComponent<Star>();
        string leafId = $"leaf-{i}";

        ConfigureStar(leaf, leafId, $"notes/{leafId}.md");
        SetPosition(leaf, new Vector3(1f + (i % 10) * 0.1f, i / 10, 0f));

        leafObjects.Add(leafObject);
        stars.Add(leaf);
        links.Add(new MapRuntimeContext.RuntimeNoteLink
        {
          SourceId = "hub",
          TargetId = leafId,
          Weight = 1f
        });
      }

      MapRuntimeContext.SetLinks(links);

      RebuildWithIndex(scope.Builder, stars, new List<TagNode>(), 80, 80);
      scope.Builder.SetDistanceVisible(scope.NoteA, true);
      FlushLineBuilder(scope.Builder);

      Assert.That(GetActiveLineCount(scope.LineParent), Is.EqualTo(50));
    }
    finally
    {
      for (int i = 0; i < leafObjects.Count; i++)
        Object.DestroyImmediate(leafObjects[i]);
    }

    yield return null;
  }

  [UnityTest]
  public IEnumerator SetDistanceVisible_FreedLineLimitRefillsFromAlreadyVisibleEndpoints()
  {
    using var scope = CreateScope();
    var noteCObject = new GameObject("LineBuilderEditModeTests_NoteC");
    var noteC = noteCObject.AddComponent<Star>();

    try
    {
      ConfigureStar(scope.NoteA, "n1", "notes/n1.md", 7);
      ConfigureStar(scope.NoteB, "n2", "notes/n2.md");
      ConfigureStar(noteC, "n3", "notes/n3.md");
      ConfigureTag(scope.Tag, 7);
      SetPosition(scope.NoteA, new Vector3(-4f, 0f, 0f));
      SetPosition(scope.NoteB, new Vector3(0f, 0f, 0f));
      SetPosition(noteC, new Vector3(4f, 0f, 0f));
      SetPosition(scope.Tag, new Vector3(-4f, 2f, 0f));

      MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>
      {
        new MapRuntimeContext.RuntimeNoteLink { SourceId = "n2", TargetId = "n3", Weight = 1f }
      });

      RebuildWithIndex(scope.Builder, new List<Star> { scope.NoteA, scope.NoteB, noteC }, new List<TagNode> { scope.Tag }, 1, 10);
      scope.Builder.SetDistanceVisible(scope.NoteB, true);
      scope.Builder.SetDistanceVisible(scope.NoteA, true);
      FlushLineBuilder(scope.Builder);
      yield return null;

      LineRenderer firstLine = GetOnlyActiveLine(scope.LineParent);
      Assert.That(firstLine.GetPosition(0), Is.EqualTo(scope.NoteB.transform.position));
      Assert.That(firstLine.GetPosition(1), Is.EqualTo(noteC.transform.position));

      scope.Builder.SetDistanceVisible(scope.NoteB, false);
      FlushLineBuilder(scope.Builder);
      yield return null;

      LineRenderer refilledLine = GetOnlyActiveLine(scope.LineParent);
      Assert.That(refilledLine.GetPosition(0), Is.EqualTo(scope.NoteA.transform.position));
      Assert.That(refilledLine.GetPosition(1), Is.EqualTo(scope.Tag.transform.position));
    }
    finally
    {
      Object.DestroyImmediate(noteCObject);
    }

    yield return null;
  }

  [UnityTest]
  public IEnumerator FocusedEndpointLines_EvictExistingLinesWithinActiveLimit()
  {
    using var scope = CreateScope();
    var noteCObject = new GameObject("LineBuilderEditModeTests_NoteC");
    var noteC = noteCObject.AddComponent<Star>();

    try
    {
      ConfigureStar(scope.NoteA, "n1", "notes/n1.md", 7);
      ConfigureStar(scope.NoteB, "n2", "notes/n2.md");
      ConfigureStar(noteC, "n3", "notes/n3.md");
      ConfigureTag(scope.Tag, 7);
      SetPosition(scope.NoteA, new Vector3(-4f, 0f, 0f));
      SetPosition(scope.NoteB, new Vector3(0f, 0f, 0f));
      SetPosition(noteC, new Vector3(4f, 0f, 0f));
      SetPosition(scope.Tag, new Vector3(-4f, 2f, 0f));

      MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>
      {
        new MapRuntimeContext.RuntimeNoteLink { SourceId = "n2", TargetId = "n3", Weight = 1f }
      });

      RebuildWithIndex(scope.Builder, new List<Star> { scope.NoteA, scope.NoteB, noteC }, new List<TagNode> { scope.Tag }, 1, 10);
      scope.Builder.SetDistanceVisible(scope.NoteB, true);
      scope.Builder.SetDistanceVisible(scope.NoteA, true);
      FlushLineBuilder(scope.Builder);

      LineRenderer firstLine = GetOnlyActiveLine(scope.LineParent);
      Assert.That(firstLine.GetPosition(0), Is.EqualTo(scope.NoteB.transform.position));
      Assert.That(firstLine.GetPosition(1), Is.EqualTo(noteC.transform.position));

      SetPrivateField(scope.Focus, "selectedStar", scope.NoteA);
      FlushLineBuilder(scope.Builder);

      LineRenderer focusedLine = GetOnlyActiveLine(scope.LineParent);
      Assert.That(focusedLine.GetPosition(0), Is.EqualTo(scope.NoteA.transform.position));
      Assert.That(focusedLine.GetPosition(1), Is.EqualTo(scope.Tag.transform.position));
    }
    finally
    {
      Object.DestroyImmediate(noteCObject);
    }

    yield return null;
  }

  [UnityTest]
  public IEnumerator NewlyVisibleEndpointLines_EvictExistingNonFocusedLinesWithinRefreshBudget()
  {
    using var scope = CreateScope();
    var noteCObject = new GameObject("LineBuilderEditModeTests_NoteC");
    var noteDObject = new GameObject("LineBuilderEditModeTests_NoteD");
    var noteC = noteCObject.AddComponent<Star>();
    var noteD = noteDObject.AddComponent<Star>();

    try
    {
      ConfigureStar(scope.NoteA, "n1", "notes/n1.md");
      ConfigureStar(scope.NoteB, "n2", "notes/n2.md");
      ConfigureStar(noteC, "n3", "notes/n3.md");
      ConfigureStar(noteD, "n4", "notes/n4.md");
      SetPosition(scope.NoteA, new Vector3(-6f, 0f, 0f));
      SetPosition(scope.NoteB, new Vector3(-4f, 0f, 0f));
      SetPosition(noteC, new Vector3(4f, 0f, 0f));
      SetPosition(noteD, new Vector3(6f, 0f, 0f));

      MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>
      {
        new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n2", Weight = 1f },
        new MapRuntimeContext.RuntimeNoteLink { SourceId = "n3", TargetId = "n4", Weight = 1f }
      });

      RebuildWithIndex(
        scope.Builder,
        new List<Star> { scope.NoteA, scope.NoteB, noteC, noteD },
        new List<TagNode>(),
        1,
        10);
      scope.Builder.SetDistanceVisible(scope.NoteA, true);
      FlushLineBuilder(scope.Builder);

      AssertLineConnects(GetOnlyActiveLine(scope.LineParent), scope.NoteA, scope.NoteB);

      scope.Builder.SetDistanceVisible(noteC, true);
      FlushLineBuilder(scope.Builder);

      AssertLineConnects(GetOnlyActiveLine(scope.LineParent), noteC, noteD);
    }
    finally
    {
      Object.DestroyImmediate(noteCObject);
      Object.DestroyImmediate(noteDObject);
    }

    yield return null;
  }

  [UnityTest]
  public IEnumerator NewlyVisibleEndpointLines_DoNotEvictFocusedLines()
  {
    using var scope = CreateScope();
    var noteCObject = new GameObject("LineBuilderEditModeTests_NoteC");
    var noteDObject = new GameObject("LineBuilderEditModeTests_NoteD");
    var noteC = noteCObject.AddComponent<Star>();
    var noteD = noteDObject.AddComponent<Star>();

    try
    {
      ConfigureStar(scope.NoteA, "n1", "notes/n1.md");
      ConfigureStar(scope.NoteB, "n2", "notes/n2.md");
      ConfigureStar(noteC, "n3", "notes/n3.md");
      ConfigureStar(noteD, "n4", "notes/n4.md");
      SetPosition(scope.NoteA, new Vector3(-6f, 0f, 0f));
      SetPosition(scope.NoteB, new Vector3(-4f, 0f, 0f));
      SetPosition(noteC, new Vector3(4f, 0f, 0f));
      SetPosition(noteD, new Vector3(6f, 0f, 0f));

      MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>
      {
        new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n2", Weight = 1f },
        new MapRuntimeContext.RuntimeNoteLink { SourceId = "n3", TargetId = "n4", Weight = 1f }
      });

      RebuildWithIndex(
        scope.Builder,
        new List<Star> { scope.NoteA, scope.NoteB, noteC, noteD },
        new List<TagNode>(),
        1,
        10);
      scope.Builder.SetDistanceVisible(scope.NoteA, true);
      SetPrivateField(scope.Focus, "selectedStar", scope.NoteA);
      FlushLineBuilder(scope.Builder);

      AssertLineConnects(GetOnlyActiveLine(scope.LineParent), scope.NoteA, scope.NoteB);

      scope.Builder.SetDistanceVisible(noteC, true);
      FlushLineBuilder(scope.Builder);

      AssertLineConnects(GetOnlyActiveLine(scope.LineParent), scope.NoteA, scope.NoteB);
    }
    finally
    {
      Object.DestroyImmediate(noteCObject);
      Object.DestroyImmediate(noteDObject);
    }

    yield return null;
  }

  [UnityTest]
  public IEnumerator Reconcile_LongLinesRespectDedicatedLimit()
  {
    using var scope = CreateScope();
    var noteCObject = new GameObject("LineBuilderEditModeTests_NoteC");
    var noteDObject = new GameObject("LineBuilderEditModeTests_NoteD");
    var noteC = noteCObject.AddComponent<Star>();
    var noteD = noteDObject.AddComponent<Star>();

    try
    {
      ConfigureStar(scope.NoteA, "n1", "notes/n1.md");
      ConfigureStar(scope.NoteB, "n2", "notes/n2.md");
      ConfigureStar(noteC, "n3", "notes/n3.md");
      ConfigureStar(noteD, "n4", "notes/n4.md");
      SetPosition(scope.NoteA, Vector3.zero);
      SetPosition(scope.NoteB, new Vector3(10f, 0f, 0f));
      SetPosition(noteC, new Vector3(12f, 0f, 0f));
      SetPosition(noteD, new Vector3(1f, 0f, 0f));
      SetPrivateField(scope.Builder, "longLineDistance", 5f);

      MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>
      {
        new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n2", Weight = 1f },
        new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n3", Weight = 1f },
        new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n4", Weight = 1f }
      });

      RebuildWithIndex(scope.Builder, new List<Star> { scope.NoteA, scope.NoteB, noteC, noteD }, new List<TagNode>(), 3, 1);
      scope.Builder.SetDistanceVisible(scope.NoteA, true);
      FlushLineBuilder(scope.Builder);

      Assert.That(GetActiveLineCount(scope.LineParent), Is.EqualTo(2));
      Assert.That(GetActiveLongLineCount(scope.LineParent, 5f), Is.EqualTo(1));
    }
    finally
    {
      Object.DestroyImmediate(noteCObject);
      Object.DestroyImmediate(noteDObject);
    }

    yield return null;
  }

  [UnityTest]
  public IEnumerator FocusedLines_RespectLongLineLimitWhenBypassIsDisabled()
  {
    using var scope = CreateScope();
    var noteCObject = new GameObject("LineBuilderEditModeTests_NoteC");
    var noteDObject = new GameObject("LineBuilderEditModeTests_NoteD");
    var noteC = noteCObject.AddComponent<Star>();
    var noteD = noteDObject.AddComponent<Star>();

    try
    {
      ConfigureStar(scope.NoteA, "n1", "notes/n1.md");
      ConfigureStar(scope.NoteB, "n2", "notes/n2.md");
      ConfigureStar(noteC, "n3", "notes/n3.md");
      ConfigureStar(noteD, "n4", "notes/n4.md");
      SetPosition(scope.NoteA, Vector3.zero);
      SetPosition(scope.NoteB, new Vector3(10f, 0f, 0f));
      SetPosition(noteC, new Vector3(12f, 0f, 0f));
      SetPosition(noteD, new Vector3(1f, 0f, 0f));
      SetPrivateField(scope.Builder, "longLineDistance", 5f);
      SetPrivateField(scope.Builder, "focusedLinesIgnoreLongLineLimit", false);
      SetPrivateField(scope.Focus, "selectedStar", scope.NoteA);

      MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>
      {
        new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n2", Weight = 1f },
        new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n3", Weight = 1f },
        new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n4", Weight = 1f }
      });

      RebuildWithIndex(
        scope.Builder,
        new List<Star> { scope.NoteA, scope.NoteB, noteC, noteD },
        new List<TagNode>(),
        3,
        0);
      scope.Builder.SetDistanceVisible(scope.NoteA, true);
      FlushLineBuilder(scope.Builder);

      Assert.That(GetActiveLineCount(scope.LineParent), Is.EqualTo(1));
      Assert.That(GetActiveLongLineCount(scope.LineParent, 5f), Is.EqualTo(0));
    }
    finally
    {
      Object.DestroyImmediate(noteCObject);
      Object.DestroyImmediate(noteDObject);
    }

    yield return null;
  }

  private static void ConfigureStar(Star star, string id, string path, params int[] tagIds)
  {
    star.SetData(new NoteData
    {
      Id = id,
      Name = id,
      Path = path,
      TagIds = new List<int>(tagIds ?? new int[0])
    });
  }

  private static void ConfigureTag(TagNode tagNode, int userTagId)
  {
    tagNode.UserTagId = userTagId;
  }

  private static void SetPosition(Component component, Vector3 position)
  {
    component.transform.position = position;
  }

  private static int GetLineCount(Transform lineParent)
  {
    return lineParent.GetComponentsInChildren<LineRenderer>(true).Length;
  }

  private static int GetActiveLineCount(Transform lineParent)
  {
    LineRenderer[] lines = lineParent.GetComponentsInChildren<LineRenderer>(true);
    int count = 0;

    for (int i = 0; i < lines.Length; i++)
    {
      if (lines[i].gameObject.activeSelf)
        count++;
    }

    return count;
  }

  private static int GetActiveLongLineCount(Transform lineParent, float longLineDistance)
  {
    LineRenderer[] lines = lineParent.GetComponentsInChildren<LineRenderer>(true);
    float longLineDistanceSquared = longLineDistance * longLineDistance;
    int count = 0;

    for (int i = 0; i < lines.Length; i++)
    {
      if (!lines[i].gameObject.activeSelf)
        continue;

      if ((lines[i].GetPosition(0) - lines[i].GetPosition(1)).sqrMagnitude > longLineDistanceSquared)
        count++;
    }

    return count;
  }

  private static int GetInactiveLineCount(LineBuilder builder)
  {
    FieldInfo field = typeof(LineBuilder).GetField("linePool", BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(field, Is.Not.Null, "Missing field linePool.");

    var pool = field.GetValue(builder) as ObjectPool<LineRenderer>;
    return pool != null ? pool.CountInactive : 0;
  }

  private static LineRenderer GetOnlyLine(Transform lineParent)
  {
    LineRenderer[] lines = lineParent.GetComponentsInChildren<LineRenderer>(true);
    Assert.That(lines, Has.Length.EqualTo(1));
    return lines[0];
  }

  private static LineRenderer GetOnlyActiveLine(Transform lineParent)
  {
    LineRenderer[] lines = lineParent.GetComponentsInChildren<LineRenderer>(true);
    LineRenderer activeLine = null;

    for (int i = 0; i < lines.Length; i++)
    {
      if (!lines[i].gameObject.activeSelf)
        continue;

      Assert.That(activeLine, Is.Null, "Expected exactly one active line.");
      activeLine = lines[i];
    }

    Assert.That(activeLine, Is.Not.Null, "Expected one active line.");
    return activeLine;
  }

  private static void AssertLineConnects(LineRenderer line, Component nodeA, Component nodeB)
  {
    Vector3 positionA = nodeA.transform.position;
    Vector3 positionB = nodeB.transform.position;
    bool forward = line.GetPosition(0) == positionA && line.GetPosition(1) == positionB;
    bool reverse = line.GetPosition(0) == positionB && line.GetPosition(1) == positionA;

    Assert.That(forward || reverse, Is.True, "Line endpoints did not match the expected nodes.");
  }

  private static void RebuildWithIndex(
    LineBuilder builder,
    IReadOnlyList<Star> stars,
    IReadOnlyList<TagNode> tagNodes,
    int maxActiveLines,
    int maxActiveLongLines)
  {
    builder.Rebuild(MapGraphIndex.Build(stars, tagNodes, MapRuntimeContext.Links), maxActiveLines, maxActiveLongLines);
  }

  private static LineBuilderScope CreateScope()
  {
    var scope = new LineBuilderScope();
    scope.ConfigureForTests();
    return scope;
  }

  private static void SetPrivateField(object target, string fieldName, object value)
  {
    FieldInfo field = target.GetType().GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(field, Is.Not.Null, $"Missing field {fieldName}.");
    field.SetValue(target, value);
  }

  private static void FlushLineBuilder(LineBuilder builder)
  {
    MethodInfo method = typeof(LineBuilder).GetMethod("LateUpdate", BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(method, Is.Not.Null, "Missing method LateUpdate.");
    method.Invoke(builder, null);
  }

  private static void ResetRuntimeContext()
  {
    MapRuntimeContext.SetTagNames(new Dictionary<int, string>());
    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>());
    MapRuntimeContext.SetNotes(new List<NoteData>());
  }

  private sealed class LineBuilderScope : System.IDisposable
  {
    public GameObject BuilderObject { get; }
    public LineBuilder Builder { get; }
    public GameObject LineParentObject { get; }
    public Transform LineParent { get; }
    public GameObject LinePrefabObject { get; }
    public LineRenderer LinePrefab { get; }
    public GameObject NoteAObject { get; }
    public Star NoteA { get; }
    public GameObject NoteBObject { get; }
    public Star NoteB { get; }
    public GameObject TagObject { get; }
    public TagNode Tag { get; }
    public GameObject FocusObject { get; }
    public FocusNode Focus { get; }

    public LineBuilderScope()
    {
      ResetRuntimeContext();

      BuilderObject = new GameObject("LineBuilderEditModeTests");
      Builder = BuilderObject.AddComponent<LineBuilder>();

      LineParentObject = new GameObject("LineBuilderEditModeTests_LineParent");
      LineParent = LineParentObject.transform;

      LinePrefabObject = new GameObject("LineBuilderEditModeTests_LinePrefab");
      LinePrefab = LinePrefabObject.AddComponent<LineRenderer>();
      LinePrefab.useWorldSpace = true;

      NoteAObject = new GameObject("LineBuilderEditModeTests_NoteA");
      NoteA = NoteAObject.AddComponent<Star>();

      NoteBObject = new GameObject("LineBuilderEditModeTests_NoteB");
      NoteB = NoteBObject.AddComponent<Star>();

      TagObject = new GameObject("LineBuilderEditModeTests_Tag");
      Tag = TagObject.AddComponent<TagNode>();

      FocusObject = new GameObject("LineBuilderEditModeTests_Focus");
      Focus = FocusObject.AddComponent<FocusNode>();
    }

    public void ConfigureForTests()
    {
      SetPrivateField(Builder, "linePrefab", LinePrefab);
      SetPrivateField(Builder, "lineParent", LineParent);
      SetPrivateField(Builder, "focusNode", Focus);
    }

    public void Dispose()
    {
      if (BuilderObject != null)
        Object.DestroyImmediate(BuilderObject);

      if (LineParentObject != null)
        Object.DestroyImmediate(LineParentObject);

      if (LinePrefabObject != null)
        Object.DestroyImmediate(LinePrefabObject);

      if (NoteAObject != null)
        Object.DestroyImmediate(NoteAObject);

      if (NoteBObject != null)
        Object.DestroyImmediate(NoteBObject);

      if (TagObject != null)
        Object.DestroyImmediate(TagObject);

      if (FocusObject != null)
        Object.DestroyImmediate(FocusObject);
    }
  }
}

public class CullingRefreshEditModeTests
{
  [Test]
  public void RefreshTargets_ReevaluatesMovedNode()
  {
    using var scope = new CullingRefreshScope();

    scope.Manager.Register(scope.Node, scope.Node.transform, scope.Consumer, 0.5f, 5f);
    scope.Manager.RefreshTargets();
    AssertPositionsEqual(GetFirstBoundingSpherePosition(scope.Manager), scope.Node.transform.position);

    scope.Node.transform.position = new Vector3(0f, 0f, 20f);
    AssertPositionsNotEqual(GetFirstBoundingSpherePosition(scope.Manager), scope.Node.transform.position);

    scope.Manager.RefreshTargets();
    AssertPositionsEqual(GetFirstBoundingSpherePosition(scope.Manager), scope.Node.transform.position);
  }

  [Test]
  public void CartographerUpdate_TickingEngineRefreshesCullingTargets()
  {
    using var scope = new CullingRefreshScope();
    var cartographerObject = new GameObject("CullingRefreshEditModeTests_Cartographer");

    try
    {
      var cartographer = cartographerObject.AddComponent<Cartographer>();
      var engine = new TickOnlyEngine();

      SetPrivateField(cartographer, "_activeEngine", engine);
      SetPrivateField(cartographer, "cullingManager", scope.Manager);

      scope.Manager.Register(scope.Node, scope.Node.transform, scope.Consumer, 0.5f, 5f);
      scope.Manager.RefreshTargets();

      scope.Node.transform.position = new Vector3(0f, 0f, 20f);
      AssertPositionsNotEqual(GetFirstBoundingSpherePosition(scope.Manager), scope.Node.transform.position);
      InvokePrivate(cartographer, "Update");

      Assert.That(engine.TickCount, Is.EqualTo(1));
      AssertPositionsEqual(GetFirstBoundingSpherePosition(scope.Manager), scope.Node.transform.position);
    }
    finally
    {
      Object.DestroyImmediate(cartographerObject);
    }
  }

  [Test]
  public void ScapeCameraWarper_RaisesOnWarpAppliedAfterRebindAndCameraDrivenWarp()
  {
    var cameraObject = new GameObject("CullingRefreshEditModeTests_WarperCamera");
    var layoutObject = new GameObject("CullingRefreshEditModeTests_WarperLayout");
    var warperObject = new GameObject("CullingRefreshEditModeTests_Warper");
    var starObject = new GameObject("CullingRefreshEditModeTests_WarperStar");

    try
    {
      var camera = cameraObject.AddComponent<Camera>();
      camera.transform.position = new Vector3(0f, 0f, -10f);

      var star = starObject.AddComponent<Star>();
      star.transform.position = new Vector3(3f, 0f, 20f);

      var warper = warperObject.AddComponent<ScapeCameraWarper>();
      SetPrivateField(warper, "cam", camera);
      SetPrivateField(warper, "layoutParent", layoutObject.transform);
      SetPrivateField(warper, "maxHzWhileMoving", 0f);

      int warpAppliedCount = 0;
      warper.OnWarpApplied += () => warpAppliedCount++;

      warper.Rebind(new StaticStarsEngine(new List<Star> { star }));
      Assert.That(warpAppliedCount, Is.EqualTo(1));

      camera.transform.position = new Vector3(0f, 0f, -8f);
      InvokePrivate(warper, "LateUpdate");

      Assert.That(warpAppliedCount, Is.EqualTo(2));
    }
    finally
    {
      Object.DestroyImmediate(cameraObject);
      Object.DestroyImmediate(layoutObject);
      Object.DestroyImmediate(warperObject);
      Object.DestroyImmediate(starObject);
    }
  }

  private static void SetPrivateField(object target, string fieldName, object value)
  {
    FieldInfo field = target.GetType().GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(field, Is.Not.Null, $"Missing field {fieldName}.");
    field.SetValue(target, value);
  }

  private static void InvokePrivate(object target, string methodName)
  {
    MethodInfo method = target.GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(method, Is.Not.Null, $"Missing method {methodName}.");
    method.Invoke(target, null);
  }

  private static Vector3 GetFirstBoundingSpherePosition(CullingManager manager)
  {
    FieldInfo field = typeof(CullingManager).GetField("boundingSpheres", BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(field, Is.Not.Null, "Missing field boundingSpheres.");

    var spheres = (BoundingSphere[])field.GetValue(manager);
    Assert.That(spheres, Has.Length.GreaterThan(0));
    return spheres[0].position;
  }

  private static void AssertPositionsEqual(Vector3 actual, Vector3 expected)
  {
    Assert.That((actual - expected).sqrMagnitude, Is.LessThanOrEqualTo(0.000001f),
      $"Expected positions to match. actual={actual}, expected={expected}");
  }

  private static void AssertPositionsNotEqual(Vector3 actual, Vector3 expected)
  {
    Assert.That((actual - expected).sqrMagnitude, Is.GreaterThan(0.000001f),
      $"Expected positions to differ. actual={actual}, expected={expected}");
  }

  private sealed class CullingRefreshScope : System.IDisposable
  {
    private readonly GameObject cameraObject;
    private readonly GameObject managerObject;
    private readonly GameObject nodeObject;

    public CullingManager Manager { get; }
    public TestCullingConsumer Consumer { get; }
    public Component Node => Consumer;

    public CullingRefreshScope()
    {
      cameraObject = new GameObject("CullingRefreshEditModeTests_Camera");
      Camera camera = cameraObject.AddComponent<Camera>();
      camera.transform.position = Vector3.zero;

      managerObject = new GameObject("CullingRefreshEditModeTests_Manager");
      Manager = managerObject.AddComponent<CullingManager>();
      SetPrivateField(Manager, "targetCamera", camera);
      SetPrivateField(Manager, "requireCameraFrustumVisibility", false);

      nodeObject = new GameObject("CullingRefreshEditModeTests_Node");
      Consumer = nodeObject.AddComponent<TestCullingConsumer>();
      nodeObject.transform.position = new Vector3(0f, 0f, 1f);
    }

    public void Dispose()
    {
      Object.DestroyImmediate(nodeObject);
      Object.DestroyImmediate(managerObject);
      Object.DestroyImmediate(cameraObject);
    }
  }

  private sealed class TestCullingConsumer : MonoBehaviour, ICullingConsumer
  {
    public bool LastVisible { get; private set; }

    public bool TryCreateDistanceEntry(Component node, out CullingManager.Entry entry)
    {
      entry = new CullingManager.Entry
      {
        node = node,
        referenceTransform = transform,
        consumer = this,
        radius = 0.5f,
        visibleDistance = 5f
      };

      return true;
    }

    public void SetDistanceVisible(Component node, bool visible)
    {
      LastVisible = visible;
    }
  }

  private sealed class TickOnlyEngine : ICartographerEngine
  {
    public int TickCount { get; private set; }
    public MapLayoutMode EngineType => MapLayoutMode.DynamicLinks;
    public int MaxActiveLines => 0;
    public int MaxActiveLongLines => 0;
    public bool RequiresTick => true;
    public float BoundRadius => 1f;
    public Vector3 Pivot => Vector3.zero;
    public ScapeCameraWarper ScapeWarper => null;
    public IReadOnlyList<Star> Stars => System.Array.Empty<Star>();
    public IReadOnlyList<TagNode> TagNodes => System.Array.Empty<TagNode>();
    public event System.Action<IReadOnlyList<Star>, IReadOnlyList<TagNode>> OnNodesChanged;

    public void BuildGraph(List<NoteData> notes) { }
    public void ClearGraph() { }
    public void Tick(float dt) => TickCount++;
    public void ApplyView(ScapeView view) { }
  }

  private sealed class StaticStarsEngine : ICartographerEngine
  {
    public StaticStarsEngine(IReadOnlyList<Star> stars)
    {
      Stars = stars;
    }

    public MapLayoutMode EngineType => MapLayoutMode.Dates;
    public int MaxActiveLines => 0;
    public int MaxActiveLongLines => 0;
    public bool RequiresTick => false;
    public float BoundRadius => 1f;
    public Vector3 Pivot => Vector3.zero;
    public ScapeCameraWarper ScapeWarper => null;
    public IReadOnlyList<Star> Stars { get; }
    public IReadOnlyList<TagNode> TagNodes => System.Array.Empty<TagNode>();
    public event System.Action<IReadOnlyList<Star>, IReadOnlyList<TagNode>> OnNodesChanged;

    public void BuildGraph(List<NoteData> notes) { }
    public void ClearGraph() { }
    public void Tick(float dt) { }
    public void ApplyView(ScapeView view) { }
  }
}
