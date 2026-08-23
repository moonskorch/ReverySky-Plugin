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
  public void LabelPresenter_FocusStateOverridesDistanceVisibilityAndRestoresNormalMaterial()
  {
    using var label = new LabelScope("FocusLabelHighlightTests_Label");
    Material normalMaterial = CreateMaterial("Normal");
    Material focusMaterial = CreateMaterial("Focus");
    Material linkedMaterial = CreateMaterial("Linked");

    label.Text.fontSharedMaterial = normalMaterial;
    SetPrivateField(label.Presenter, "normalMaterialPreset", normalMaterial);
    SetPrivateField(label.Presenter, "focusedMaterialPreset", focusMaterial);
    SetPrivateField(label.Presenter, "linkedMaterialPreset", linkedMaterial);
    StartPresenter(label.Presenter);

    label.VisibilitySource.SetDistanceVisible(null, false);

    Assert.That(label.LabelRoot.activeSelf, Is.False);

    label.VisibilitySource.SetHighlightState(LabelHighlightState.Focused);

    Assert.That(label.LabelRoot.activeSelf, Is.True);
    Assert.That(label.Text.fontSharedMaterial, Is.SameAs(focusMaterial));

    label.VisibilitySource.SetHighlightState(LabelHighlightState.Normal);

    Assert.That(label.LabelRoot.activeSelf, Is.False);
    Assert.That(label.Text.fontSharedMaterial, Is.SameAs(normalMaterial));

    label.VisibilitySource.SetHighlightState(LabelHighlightState.Linked);
    label.VisibilitySource.SetDistanceVisible(null, false);

    Assert.That(label.LabelRoot.activeSelf, Is.True);
    Assert.That(label.Text.fontSharedMaterial, Is.SameAs(linkedMaterial));

    Object.DestroyImmediate(linkedMaterial);
    Object.DestroyImmediate(focusMaterial);
    Object.DestroyImmediate(normalMaterial);
  }

  [Test]
  public void LabelPresenter_RequeriesCurrentTmpTextWhenApplyingState()
  {
    using var label = new LabelScope("FocusLabelHighlightTests_RequeryLabel");
    Material normalMaterial = CreateMaterial("Normal");
    Material replacementMaterial = CreateMaterial("Replacement");
    Material focusMaterial = CreateMaterial("Focus");
    Material linkedMaterial = CreateMaterial("Linked");

    label.Text.fontSharedMaterial = normalMaterial;
    SetPrivateField(label.Presenter, "normalMaterialPreset", normalMaterial);
    SetPrivateField(label.Presenter, "focusedMaterialPreset", focusMaterial);
    SetPrivateField(label.Presenter, "linkedMaterialPreset", linkedMaterial);
    StartPresenter(label.Presenter);

    label.VisibilitySource.SetHighlightState(LabelHighlightState.Focused);
    Assert.That(label.Text.fontSharedMaterial, Is.SameAs(focusMaterial));

    label.ReplaceText(replacementMaterial);
    label.VisibilitySource.SetHighlightState(LabelHighlightState.Linked);

    Assert.That(label.Text.fontSharedMaterial, Is.SameAs(linkedMaterial));

    label.VisibilitySource.SetHighlightState(LabelHighlightState.Normal);

    Assert.That(label.Text.fontSharedMaterial, Is.SameAs(normalMaterial));

    Object.DestroyImmediate(linkedMaterial);
    Object.DestroyImmediate(focusMaterial);
    Object.DestroyImmediate(replacementMaterial);
    Object.DestroyImmediate(normalMaterial);
  }

  [Test]
  public void LabelPresenter_AppliesMaterialToAllTmpTextsUnderLabelRoot()
  {
    using var label = new LabelScope("FocusLabelHighlightTests_MultipleTexts");
    Material normalMaterial = CreateMaterial("Normal");
    Material secondInitialMaterial = CreateMaterial("SecondInitial");
    Material focusMaterial = CreateMaterial("Focus");

    label.Text.fontSharedMaterial = normalMaterial;
    TMP_Text secondText = label.AddText(secondInitialMaterial);
    SetPrivateField(label.Presenter, "normalMaterialPreset", normalMaterial);
    SetPrivateField(label.Presenter, "focusedMaterialPreset", focusMaterial);
    StartPresenter(label.Presenter);

    label.VisibilitySource.SetHighlightState(LabelHighlightState.Focused);

    Assert.That(label.Text.fontSharedMaterial, Is.SameAs(focusMaterial));
    Assert.That(secondText.fontSharedMaterial, Is.SameAs(focusMaterial));

    label.VisibilitySource.SetHighlightState(LabelHighlightState.Normal);

    Assert.That(label.Text.fontSharedMaterial, Is.SameAs(normalMaterial));
    Assert.That(secondText.fontSharedMaterial, Is.SameAs(normalMaterial));

    Object.DestroyImmediate(focusMaterial);
    Object.DestroyImmediate(secondInitialMaterial);
    Object.DestroyImmediate(normalMaterial);
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

    graph.LabelA.VisibilitySource.SetDistanceVisible(graph.NoteA, false);
    graph.LabelB.VisibilitySource.SetDistanceVisible(graph.NoteB, false);
    graph.LabelC.VisibilitySource.SetDistanceVisible(graph.NoteC, false);

    graph.Highlighter.SetFocus(GetNode(index, graph.NoteA), index);

    Assert.That(graph.LabelA.LabelRoot.activeSelf, Is.True);
    Assert.That(graph.LabelB.LabelRoot.activeSelf, Is.True);
    Assert.That(graph.LabelC.LabelRoot.activeSelf, Is.False);
    Assert.That(graph.LabelA.Text.fontSharedMaterial, Is.SameAs(graph.FocusMaterial));
    Assert.That(graph.LabelB.Text.fontSharedMaterial, Is.SameAs(graph.LinkedMaterial));
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

    graph.LabelA.VisibilitySource.SetDistanceVisible(graph.NoteA, false);
    graph.LabelB.VisibilitySource.SetDistanceVisible(graph.NoteB, false);
    graph.LabelC.VisibilitySource.SetDistanceVisible(graph.NoteC, false);

    graph.Highlighter.SetFocus(GetNode(index, graph.NoteA), index);
    graph.Highlighter.SetFocus(GetNode(index, graph.NoteC), index);

    Assert.That(graph.LabelA.LabelRoot.activeSelf, Is.False);
    Assert.That(graph.LabelB.LabelRoot.activeSelf, Is.False);
    Assert.That(graph.LabelC.LabelRoot.activeSelf, Is.True);
    Assert.That(graph.LabelA.Text.fontSharedMaterial, Is.SameAs(graph.NormalMaterial));
    Assert.That(graph.LabelB.Text.fontSharedMaterial, Is.SameAs(graph.NormalMaterial));
    Assert.That(graph.LabelC.Text.fontSharedMaterial, Is.SameAs(graph.FocusMaterial));
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

    graph.LabelA.VisibilitySource.SetDistanceVisible(graph.NoteA, false);
    graph.LabelB.VisibilitySource.SetDistanceVisible(graph.NoteB, false);

    graph.Highlighter.SetFocus(GetNode(index, graph.NoteA), index);
    graph.Highlighter.SetFocus(GetNode(index, graph.NoteB), index);

    Assert.That(graph.LabelA.LabelRoot.activeSelf, Is.True);
    Assert.That(graph.LabelB.LabelRoot.activeSelf, Is.True);
    Assert.That(graph.LabelA.Text.fontSharedMaterial, Is.SameAs(graph.LinkedMaterial));
    Assert.That(graph.LabelB.Text.fontSharedMaterial, Is.SameAs(graph.FocusMaterial));
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
    MapRuntimeContext.SetNotes(new List<NoteData>(), string.Empty);
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

  private static void StartPresenter(LabelPresenter presenter)
  {
    MethodInfo startMethod = typeof(LabelPresenter).GetMethod("Start", BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(startMethod, Is.Not.Null, "Missing LabelPresenter.Start.");
    startMethod.Invoke(presenter, null);
  }

  private static Material CreateMaterial(string name)
  {
    Shader shader = Shader.Find("TextMeshPro/Distance Field");
    if (shader == null)
      shader = Shader.Find("Sprites/Default");

    Assert.That(shader, Is.Not.Null, "Expected a built-in shader for test materials.");
    return new Material(shader) { name = $"FocusLabelHighlightTests_{name}" };
  }

  private sealed class LabelScope : System.IDisposable
  {
    private readonly GameObject rootObject;
    private GameObject textObject;

    public LabelScope(string name, GameObject presenterHost = null)
    {
      rootObject = presenterHost == null ? new GameObject(name) : null;
      GameObject hostObject = presenterHost != null ? presenterHost : rootObject;
      VisibilitySource = hostObject.AddComponent<NodeVisibility>();
      Presenter = hostObject.AddComponent<LabelPresenter>();
      LabelRoot = new GameObject($"{name}_Root");
      LabelRoot.transform.SetParent(hostObject.transform, false);
      ReplaceText(null);

      SetPrivateField(Presenter, "labelRoot", LabelRoot);
    }

    public LabelPresenter Presenter { get; }
    public NodeVisibility VisibilitySource { get; }
    public GameObject LabelRoot { get; }
    public TMP_Text Text { get; private set; }

    public void ReplaceText(Material material)
    {
      if (textObject != null)
        Object.DestroyImmediate(textObject);

      Text = AddText(material);
      textObject = Text.gameObject;
    }

    public TMP_Text AddText(Material material)
    {
      var textGameObject = new GameObject($"{LabelRoot.name}_Text");
      textGameObject.transform.SetParent(LabelRoot.transform, false);
      TMP_Text text = textGameObject.AddComponent<TextMeshPro>();
      if (material != null)
        text.fontSharedMaterial = material;
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

    public readonly Material NormalMaterial;
    public readonly Material FocusMaterial;
    public readonly Material LinkedMaterial;

    public GraphScope()
    {
      NormalMaterial = CreateMaterial("GraphNormal");
      FocusMaterial = CreateMaterial("GraphFocus");
      LinkedMaterial = CreateMaterial("GraphLinked");

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
      label.Text.fontSharedMaterial = NormalMaterial;
      SetPrivateField(label.Presenter, "normalMaterialPreset", NormalMaterial);
      SetPrivateField(label.Presenter, "focusedMaterialPreset", FocusMaterial);
      SetPrivateField(label.Presenter, "linkedMaterialPreset", LinkedMaterial);
      StartPresenter(label.Presenter);

      return nodeObject;
    }

    public void Dispose()
    {
      Object.DestroyImmediate(noteCObject);
      Object.DestroyImmediate(noteBObject);
      Object.DestroyImmediate(noteAObject);
      Object.DestroyImmediate(highlighterObject);
      Object.DestroyImmediate(LinkedMaterial);
      Object.DestroyImmediate(FocusMaterial);
      Object.DestroyImmediate(NormalMaterial);
    }
  }
}
