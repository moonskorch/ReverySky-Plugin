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

    scope.Builder.Rebuild(new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode> { scope.Tag }, 4);

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

    scope.Builder.Rebuild(new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode> { scope.Tag }, 4);
    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    yield return null;

    LineRenderer[] lines = scope.LineParent.GetComponentsInChildren<LineRenderer>(true);
    Assert.That(lines, Has.Length.EqualTo(1));
    Assert.That(lines[0].GetPosition(0), Is.EqualTo(scope.NoteA.transform.position));
    Assert.That(lines[0].GetPosition(1), Is.EqualTo(scope.NoteB.transform.position));
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

    scope.Builder.Rebuild(new List<Star> { scope.NoteA }, new List<TagNode> { scope.Tag }, 4);
    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    scope.Builder.SetDistanceVisible(scope.Tag, true);
    yield return null;

    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(1));
    Assert.That(GetActiveLineCount(scope.LineParent), Is.EqualTo(1));

    scope.Builder.SetDistanceVisible(scope.NoteA, false);
    yield return null;
    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(1));
    Assert.That(GetActiveLineCount(scope.LineParent), Is.EqualTo(1));

    scope.Builder.SetDistanceVisible(scope.Tag, false);
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

    scope.Builder.Rebuild(new List<Star> { scope.NoteA }, new List<TagNode> { scope.Tag }, 4);
    Assert.That(GetInactiveLineCount(scope.Builder), Is.EqualTo(0));

    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    scope.Builder.SetDistanceVisible(scope.Tag, true);
    yield return null;

    Assert.That(GetInactiveLineCount(scope.Builder), Is.EqualTo(0));

    scope.Builder.SetDistanceVisible(scope.NoteA, false);
    yield return null;
    Assert.That(GetInactiveLineCount(scope.Builder), Is.EqualTo(0));

    scope.Builder.SetDistanceVisible(scope.Tag, false);
    Assert.That(GetInactiveLineCount(scope.Builder), Is.EqualTo(1));

    scope.Builder.SetDistanceVisible(scope.Tag, false);
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

    scope.Builder.Rebuild(new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode>(), 1);
    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    yield return null;

    LineRenderer firstLine = GetOnlyLine(scope.LineParent);
    Assert.That(firstLine.gameObject.activeSelf, Is.True);

    scope.Builder.SetDistanceVisible(scope.NoteA, false);
    yield return null;
    Assert.That(firstLine.gameObject.activeSelf, Is.False);

    scope.Builder.SetDistanceVisible(scope.NoteB, true);
    yield return null;

    LineRenderer reusedLine = GetOnlyLine(scope.LineParent);
    Assert.That(reusedLine, Is.SameAs(firstLine));
    Assert.That(reusedLine.gameObject.activeSelf, Is.True);
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

    scope.Builder.Rebuild(new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode>(), 1);
    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    yield return null;
    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(1));

    scope.Builder.SetDistanceVisible(scope.NoteA, false);
    yield return null;
    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(1));

    scope.Builder.Rebuild(new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode>(), 0);
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

    scope.Builder.Rebuild(new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode> { scope.Tag }, 2);
    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    yield return null;
    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(2));

    scope.Builder.SetDistanceVisible(scope.NoteA, false);
    yield return null;
    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(2));
    Assert.That(GetActiveLineCount(scope.LineParent), Is.EqualTo(0));

    scope.Builder.Rebuild(new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode> { scope.Tag }, 1);
    yield return null;
    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(0));

    scope.Builder.SetDistanceVisible(scope.NoteA, true);
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

    scope.Builder.Rebuild(new List<Star> { scope.NoteA, scope.NoteB }, new List<TagNode> { scope.Tag }, 1);
    scope.Builder.SetDistanceVisible(scope.NoteA, true);
    scope.Builder.SetDistanceVisible(scope.NoteB, true);
    scope.Builder.SetDistanceVisible(scope.Tag, true);
    yield return null;

    Assert.That(GetLineCount(scope.LineParent), Is.EqualTo(1));
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
    }

    public void ConfigureForTests()
    {
      SetPrivateField(Builder, "linePrefab", LinePrefab);
      SetPrivateField(Builder, "lineParent", LineParent);
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
    }
  }
}
