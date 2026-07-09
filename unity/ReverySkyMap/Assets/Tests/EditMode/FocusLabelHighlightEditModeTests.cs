using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using TMPro;
using UnityEngine;

public class FocusLabelHighlightEditModeTests
{
  [SetUp]
  public void SetUp()
  {
    ResetRuntimeContext();
  }

  [TearDown]
  public void TearDown()
  {
    ResetRuntimeContext();
  }

  [Test]
  public void LabelPresenter_FocusStateOverridesDistanceVisibilityAndRestoresNormalColor()
  {
    using var label = new LabelScope("FocusLabelHighlightTests_Label");
    var normalColor = new Color(0.8f, 0.7f, 0.4f, 1f);
    var focusColor = new Color(0f, 2f, 2f, 1f);
    var linkedColor = new Color(0.4f, 0.9f, 1f, 1f);

    label.Text.color = normalColor;
    SetPrivateField(label.Presenter, "focusedTextColor", focusColor);
    SetPrivateField(label.Presenter, "linkedTextColor", linkedColor);

    label.Presenter.SetDistanceVisible(null, false);

    Assert.That(label.LabelRoot.activeSelf, Is.False);

    label.Presenter.SetHighlightState(LabelHighlightState.Focused);

    Assert.That(label.LabelRoot.activeSelf, Is.True);
    AssertColorApproximately(label.Text.color, focusColor);

    label.Presenter.SetHighlightState(LabelHighlightState.Normal);

    Assert.That(label.LabelRoot.activeSelf, Is.False);
    AssertColorApproximately(label.Text.color, normalColor);

    label.Presenter.SetHighlightState(LabelHighlightState.Linked);
    label.Presenter.SetDistanceVisible(null, false);

    Assert.That(label.LabelRoot.activeSelf, Is.True);
    AssertColorApproximately(label.Text.color, linkedColor);
  }

  [Test]
  public void LabelPresenter_RequeriesCurrentTmpTextWhenApplyingState()
  {
    using var label = new LabelScope("FocusLabelHighlightTests_RequeryLabel");
    var firstNormalColor = new Color(0.8f, 0.7f, 0.4f, 1f);
    var secondNormalColor = new Color(0.3f, 0.6f, 0.9f, 1f);
    var focusColor = new Color(0f, 2f, 2f, 1f);
    var linkedColor = new Color(0.4f, 0.9f, 1f, 1f);

    label.Text.color = firstNormalColor;
    SetPrivateField(label.Presenter, "focusedTextColor", focusColor);
    SetPrivateField(label.Presenter, "linkedTextColor", linkedColor);

    label.Presenter.SetHighlightState(LabelHighlightState.Focused);
    AssertColorApproximately(label.Text.color, focusColor);

    label.ReplaceText(secondNormalColor);
    label.Presenter.SetHighlightState(LabelHighlightState.Linked);

    AssertColorApproximately(label.Text.color, linkedColor);

    label.Presenter.SetHighlightState(LabelHighlightState.Normal);

    AssertColorApproximately(label.Text.color, secondNormalColor);
  }

  [Test]
  public void LabelPresenter_ColorsAllTmpTextsUnderLabelRoot()
  {
    using var label = new LabelScope("FocusLabelHighlightTests_MultipleTexts");
    var firstNormalColor = new Color(0.8f, 0.7f, 0.4f, 1f);
    var secondNormalColor = new Color(0.3f, 0.6f, 0.9f, 1f);
    var focusColor = new Color(0f, 2f, 2f, 1f);

    label.Text.color = firstNormalColor;
    TMP_Text secondText = label.AddText(secondNormalColor);
    SetPrivateField(label.Presenter, "focusedTextColor", focusColor);

    label.Presenter.SetHighlightState(LabelHighlightState.Focused);

    AssertColorApproximately(label.Text.color, focusColor);
    AssertColorApproximately(secondText.color, focusColor);

    label.Presenter.SetHighlightState(LabelHighlightState.Normal);

    AssertColorApproximately(label.Text.color, firstNormalColor);
    AssertColorApproximately(secondText.color, secondNormalColor);
  }

  [Test]
  public void FocusHighlighter_AppliesFocusedAndLinkedLabelStates()
  {
    using var graph = new GraphScope();
    ConfigureStar(graph.NoteA, "n1");
    ConfigureStar(graph.NoteB, "n2");
    ConfigureStar(graph.NoteC, "n3");

    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>
    {
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n2", Weight = 1f }
    });

    MapGraphIndex index = MapGraphIndex.Build(
      new List<Star> { graph.NoteA, graph.NoteB, graph.NoteC },
      new List<TagNode>(),
      MapRuntimeContext.Links);

    graph.LabelA.Presenter.SetDistanceVisible(graph.NoteA, false);
    graph.LabelB.Presenter.SetDistanceVisible(graph.NoteB, false);
    graph.LabelC.Presenter.SetDistanceVisible(graph.NoteC, false);

    graph.Highlighter.SetFocus(GetNode(index, graph.NoteA), index);

    Assert.That(graph.LabelA.LabelRoot.activeSelf, Is.True);
    Assert.That(graph.LabelB.LabelRoot.activeSelf, Is.True);
    Assert.That(graph.LabelC.LabelRoot.activeSelf, Is.False);
    AssertColorApproximately(graph.LabelA.Text.color, graph.FocusColor);
    AssertColorApproximately(graph.LabelB.Text.color, graph.LinkedColor);
  }

  [Test]
  public void FocusHighlighter_ClearsPreviousLabelStates()
  {
    using var graph = new GraphScope();
    ConfigureStar(graph.NoteA, "n1");
    ConfigureStar(graph.NoteB, "n2");
    ConfigureStar(graph.NoteC, "n3");

    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>
    {
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n2", Weight = 1f }
    });

    MapGraphIndex index = MapGraphIndex.Build(
      new List<Star> { graph.NoteA, graph.NoteB, graph.NoteC },
      new List<TagNode>(),
      MapRuntimeContext.Links);

    graph.LabelA.Presenter.SetDistanceVisible(graph.NoteA, false);
    graph.LabelB.Presenter.SetDistanceVisible(graph.NoteB, false);
    graph.LabelC.Presenter.SetDistanceVisible(graph.NoteC, false);

    graph.Highlighter.SetFocus(GetNode(index, graph.NoteA), index);
    graph.Highlighter.SetFocus(GetNode(index, graph.NoteC), index);

    Assert.That(graph.LabelA.LabelRoot.activeSelf, Is.False);
    Assert.That(graph.LabelB.LabelRoot.activeSelf, Is.False);
    Assert.That(graph.LabelC.LabelRoot.activeSelf, Is.True);
    AssertColorApproximately(graph.LabelA.Text.color, graph.NormalColor);
    AssertColorApproximately(graph.LabelB.Text.color, graph.NormalColor);
    AssertColorApproximately(graph.LabelC.Text.color, graph.FocusColor);
  }

  [Test]
  public void FocusHighlighter_UpdatesOverlappingLabelStatesWithoutClearingFirst()
  {
    using var graph = new GraphScope();
    ConfigureStar(graph.NoteA, "n1");
    ConfigureStar(graph.NoteB, "n2");

    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>
    {
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n2", Weight = 1f }
    });

    MapGraphIndex index = MapGraphIndex.Build(
      new List<Star> { graph.NoteA, graph.NoteB },
      new List<TagNode>(),
      MapRuntimeContext.Links);

    graph.LabelA.Presenter.SetDistanceVisible(graph.NoteA, false);
    graph.LabelB.Presenter.SetDistanceVisible(graph.NoteB, false);

    graph.Highlighter.SetFocus(GetNode(index, graph.NoteA), index);
    graph.Highlighter.SetFocus(GetNode(index, graph.NoteB), index);

    Assert.That(graph.LabelA.LabelRoot.activeSelf, Is.True);
    Assert.That(graph.LabelB.LabelRoot.activeSelf, Is.True);
    AssertColorApproximately(graph.LabelA.Text.color, graph.LinkedColor);
    AssertColorApproximately(graph.LabelB.Text.color, graph.FocusColor);
  }

  [Test]
  public void FocusHighlighter_IgnoresStaleLabelStateMissingFromCurrentGraphIndex()
  {
    using var graph = new GraphScope();
    ConfigureStar(graph.NoteA, "n1");
    ConfigureStar(graph.NoteB, "n2");

    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>
    {
      new MapRuntimeContext.RuntimeNoteLink { SourceId = "n1", TargetId = "n2", Weight = 1f }
    });

    MapGraphIndex index = MapGraphIndex.Build(
      new List<Star> { graph.NoteA, graph.NoteB },
      new List<TagNode>(),
      MapRuntimeContext.Links);

    graph.Highlighter.SetFocus(GetNode(index, graph.NoteA), index);

    Assert.DoesNotThrow(() => graph.Highlighter.SetFocus(null, MapGraphIndex.Empty));
  }

  private static void ConfigureStar(Star star, string id)
  {
    star.SetData(new NoteData
    {
      Id = id,
      Name = id,
      Path = $"notes/{id}.md",
      TagIds = new List<int>()
    });
  }

  private static void ResetRuntimeContext()
  {
    MapRuntimeContext.SetTagNames(new Dictionary<int, string>());
    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>());
    MapRuntimeContext.SetNotes(new List<NoteData>());
  }

  private static MapGraphNode GetNode(MapGraphIndex index, Component component)
  {
    Assert.That(index.TryGetNodeId(component, out var nodeId), Is.True);
    Assert.That(index.TryGetNode(nodeId, out var node), Is.True);
    return node;
  }

  private static void SetPrivateField(object target, string fieldName, object value)
  {
    FieldInfo field = target.GetType().GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(field, Is.Not.Null, $"Missing field {fieldName}.");
    field.SetValue(target, value);
  }

  private static void AssertColorApproximately(Color actual, Color expected)
  {
    const float tolerance = 0.001f;
    Assert.That(Mathf.Abs(actual.r - expected.r), Is.LessThanOrEqualTo(tolerance), $"r actual={actual.r:R} expected={expected.r:R}");
    Assert.That(Mathf.Abs(actual.g - expected.g), Is.LessThanOrEqualTo(tolerance), $"g actual={actual.g:R} expected={expected.g:R}");
    Assert.That(Mathf.Abs(actual.b - expected.b), Is.LessThanOrEqualTo(tolerance), $"b actual={actual.b:R} expected={expected.b:R}");
    Assert.That(Mathf.Abs(actual.a - expected.a), Is.LessThanOrEqualTo(tolerance), $"a actual={actual.a:R} expected={expected.a:R}");
  }

  private sealed class LabelScope : System.IDisposable
  {
    private readonly GameObject rootObject;
    private GameObject textObject;

    public LabelScope(string name, GameObject presenterHost = null)
    {
      rootObject = presenterHost == null ? new GameObject(name) : null;
      GameObject hostObject = presenterHost != null ? presenterHost : rootObject;
      Presenter = hostObject.AddComponent<LabelPresenter>();
      LabelRoot = new GameObject($"{name}_Root");
      LabelRoot.transform.SetParent(hostObject.transform, false);
      ReplaceText(Color.white);

      SetPrivateField(Presenter, "labelRoot", LabelRoot);
    }

    public LabelPresenter Presenter { get; }
    public GameObject LabelRoot { get; }
    public TMP_Text Text { get; private set; }

    public void ReplaceText(Color color)
    {
      if (textObject != null)
        Object.DestroyImmediate(textObject);

      Text = AddText(color);
      textObject = Text.gameObject;
    }

    public TMP_Text AddText(Color color)
    {
      var textGameObject = new GameObject($"{LabelRoot.name}_Text");
      textGameObject.transform.SetParent(LabelRoot.transform, false);
      TMP_Text text = textGameObject.AddComponent<TextMeshPro>();
      text.color = color;
      return text;
    }

    public void Dispose()
    {
      if (rootObject != null)
        Object.DestroyImmediate(rootObject);
    }
  }

  private sealed class GraphScope : System.IDisposable
  {
    private readonly GameObject highlighterObject;
    private readonly GameObject noteAObject;
    private readonly GameObject noteBObject;
    private readonly GameObject noteCObject;

    public readonly Color NormalColor = new(0.8f, 0.7f, 0.4f, 1f);
    public readonly Color FocusColor = new(0f, 2f, 2f, 1f);
    public readonly Color LinkedColor = new(0.4f, 0.9f, 1f, 1f);

    public GraphScope()
    {
      highlighterObject = new GameObject("FocusLabelHighlightTests_Highlighter");
      Highlighter = highlighterObject.AddComponent<FocusHighlighter>();

      noteAObject = CreateNode("FocusLabelHighlightTests_NoteA", out var noteA, out var labelA);
      noteBObject = CreateNode("FocusLabelHighlightTests_NoteB", out var noteB, out var labelB);
      noteCObject = CreateNode("FocusLabelHighlightTests_NoteC", out var noteC, out var labelC);

      NoteA = noteA;
      NoteB = noteB;
      NoteC = noteC;
      LabelA = labelA;
      LabelB = labelB;
      LabelC = labelC;
    }

    public FocusHighlighter Highlighter { get; }
    public Star NoteA { get; }
    public Star NoteB { get; }
    public Star NoteC { get; }
    public LabelScope LabelA { get; }
    public LabelScope LabelB { get; }
    public LabelScope LabelC { get; }

    private GameObject CreateNode(string name, out Star star, out LabelScope label)
    {
      var nodeObject = new GameObject(name);
      star = nodeObject.AddComponent<Star>();
      label = new LabelScope($"{name}_Label", nodeObject);
      label.Text.color = NormalColor;
      SetPrivateField(label.Presenter, "focusedTextColor", FocusColor);
      SetPrivateField(label.Presenter, "linkedTextColor", LinkedColor);

      return nodeObject;
    }

    public void Dispose()
    {
      Object.DestroyImmediate(noteCObject);
      Object.DestroyImmediate(noteBObject);
      Object.DestroyImmediate(noteAObject);
      Object.DestroyImmediate(highlighterObject);
    }
  }
}
