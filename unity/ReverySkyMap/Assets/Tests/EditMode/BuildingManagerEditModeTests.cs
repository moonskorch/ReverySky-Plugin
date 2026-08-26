using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using TMPro;
using UnityEditor;
using UnityEngine;
using UnityEngine.Pool;
using UnityEngine.TestTools;

public sealed class BuildingManagerEditModeTests
{
  [Test]
  public void Register_NormalStars_ShowAllOrNothingWithinBudget()
  {
    using var scope = new BuildingManagerScope(calloutBudget: 3);
    using var first = new StarVisualScope("First", 2);
    using var second = new StarVisualScope("Second", 2);

    scope.Manager.Register(first.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);
    scope.Manager.Register(second.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);

    Assert.That(first.Root.GetComponentsInChildren<BuildingCallout>(true), Has.Length.EqualTo(2));
    Assert.That(second.Root.GetComponentsInChildren<BuildingCallout>(true), Is.Empty);
  }

  [Test]
  public void Register_NewVisibleStarWithoutBuildings_DoesNotCreateState()
  {
    using var scope = new BuildingManagerScope(calloutBudget: 1);
    using var visual = new StarVisualScope("Empty", 0);

    scope.Manager.Register(visual.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);

    Assert.That(visual.Root.GetComponentsInChildren<BuildingCallout>(true), Is.Empty);
    Assert.That(GetStarBuildingState(scope.Manager), Is.Empty);
  }

  [Test]
  public void Register_ExistingVisibleStarWithoutBuildings_ClearsState()
  {
    using var cartographer = new CartographerScope(ScapeView.Buildings);
    using var scope = new BuildingManagerScope(calloutBudget: 1);
    using var visual = new StarVisualScope("Cleared", 1);

    scope.Manager.Register(visual.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);
    visual.Star.Data.Buildings.Clear();
    scope.Manager.Register(visual.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);

    Assert.That(visual.Root.GetComponentsInChildren<BuildingCallout>(true), Is.Empty);
    Assert.That(GetStarBuildingState(scope.Manager), Is.Empty);
  }

  [Test]
  public void Register_NormalStar_CapsCalloutsAtDirectionSlotCount()
  {
    using var scope = new BuildingManagerScope(calloutBudget: 16);
    using var visual = new StarVisualScope("NormalOverflow", 17);

    scope.Manager.Register(visual.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);

    Assert.That(visual.Visual.BuildingData, Has.Count.EqualTo(17));
    Assert.That(visual.Root.GetComponentsInChildren<BuildingCallout>(true), Has.Length.EqualTo(16));
  }

  [Test]
  public void Register_FocusedStar_OverflowsBudgetWithoutReleasingNormalStars()
  {
    using var scope = new BuildingManagerScope(calloutBudget: 2);
    using var normal = new StarVisualScope("Normal", 2);
    using var focused = new StarVisualScope("Focused", 3);

    scope.Manager.Register(normal.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);
    scope.Manager.Register(focused.Visual, wantsVisible: true, highlightState: LabelHighlightState.Focused);

    Assert.That(normal.Root.GetComponentsInChildren<BuildingCallout>(true), Has.Length.EqualTo(2));
    Assert.That(focused.Root.GetComponentsInChildren<BuildingCallout>(true), Has.Length.EqualTo(3));
  }

  [Test]
  public void Register_FocusedStar_CapsCalloutsAtDirectionSlotCount()
  {
    using var scope = new BuildingManagerScope(calloutBudget: 0);
    using var visual = new StarVisualScope("FocusedOverflow", 17);

    scope.Manager.Register(visual.Visual, wantsVisible: true, highlightState: LabelHighlightState.Focused);

    Assert.That(visual.Visual.BuildingData, Has.Count.EqualTo(17));
    Assert.That(visual.Root.GetComponentsInChildren<BuildingCallout>(true), Has.Length.EqualTo(16));
  }

  [Test]
  public void Register_FocusedStar_DoesNotConsumeNormalBudget()
  {
    using var scope = new BuildingManagerScope(calloutBudget: 2);
    using var focused = new StarVisualScope("Focused", 3);
    using var normal = new StarVisualScope("Normal", 2);

    scope.Manager.Register(focused.Visual, wantsVisible: true, highlightState: LabelHighlightState.Focused);
    scope.Manager.Register(normal.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);

    Assert.That(focused.Root.GetComponentsInChildren<BuildingCallout>(true), Has.Length.EqualTo(3));
    Assert.That(normal.Root.GetComponentsInChildren<BuildingCallout>(true), Has.Length.EqualTo(2));
  }

  [Test]
  public void Register_NormalStarEnteringFocus_RefillsFreedNormalBudget()
  {
    using var cartographer = new CartographerScope(ScapeView.Buildings);
    using var scope = new BuildingManagerScope(calloutBudget: 2);
    using var focused = new StarVisualScope("Focused", 2);
    using var waiting = new StarVisualScope("Waiting", 1);

    scope.Manager.Register(focused.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);
    scope.Manager.Register(waiting.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);
    scope.Manager.Register(focused.Visual, wantsVisible: true, highlightState: LabelHighlightState.Focused);

    Assert.That(focused.Root.GetComponentsInChildren<BuildingCallout>(true), Has.Length.EqualTo(2));
    Assert.That(waiting.Root.GetComponentsInChildren<BuildingCallout>(true), Has.Length.EqualTo(1));
  }

  [Test]
  public void Register_FocusedStarLeavingFocus_HidesWhenFullSetDoesNotFitNormalBudget()
  {
    using var scope = new BuildingManagerScope(calloutBudget: 2);
    using var focused = new StarVisualScope("Focused", 3);
    using var normal = new StarVisualScope("Normal", 2);

    scope.Manager.Register(focused.Visual, wantsVisible: true, highlightState: LabelHighlightState.Focused);
    scope.Manager.Register(normal.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);
    scope.Manager.Register(focused.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);

    Assert.That(focused.Root.GetComponentsInChildren<BuildingCallout>(true), Is.Empty);
    Assert.That(normal.Root.GetComponentsInChildren<BuildingCallout>(true), Has.Length.EqualTo(2));
  }

  [Test]
  public void Register_ExistingNormalCalloutsAfterFocusedOverflow_UpdateHighlightWithoutReleasing()
  {
    using var scope = new BuildingManagerScope(calloutBudget: 2);
    using var normal = new StarVisualScope("Normal", 2);
    using var focused = new StarVisualScope("Focused", 3);

    scope.Manager.Register(normal.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);
    scope.Manager.Register(focused.Visual, wantsVisible: true, highlightState: LabelHighlightState.Focused);
    scope.Manager.Register(normal.Visual, wantsVisible: true, highlightState: LabelHighlightState.Linked);

    Assert.That(normal.Root.GetComponentsInChildren<BuildingCallout>(true), Has.Length.EqualTo(2));
    Assert.That(focused.Root.GetComponentsInChildren<BuildingCallout>(true), Has.Length.EqualTo(3));
  }

  [Test]
  public void Register_PendingNormalStar_RefillsWhenBudgetFreedInBuildingsView()
  {
    using var cartographer = new CartographerScope(ScapeView.Buildings);
    using var scope = new BuildingManagerScope(calloutBudget: 2);
    using var first = new StarVisualScope("First", 2);
    using var waiting = new StarVisualScope("Waiting", 1);

    scope.Manager.Register(first.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);
    scope.Manager.Register(waiting.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);

    Assert.That(waiting.Root.GetComponentsInChildren<BuildingCallout>(true), Is.Empty);

    scope.Manager.Register(first.Visual, wantsVisible: false, highlightState: LabelHighlightState.Normal);

    Assert.That(first.Root.GetComponentsInChildren<BuildingCallout>(true), Is.Empty);
    Assert.That(waiting.Root.GetComponentsInChildren<BuildingCallout>(true), Has.Length.EqualTo(1));
  }

  [Test]
  public void Register_PendingNormalStar_DoesNotRefillWhenBudgetFreedOutsideBuildingsView()
  {
    using var cartographer = new CartographerScope(ScapeView.Planets);
    using var scope = new BuildingManagerScope(calloutBudget: 2);
    using var first = new StarVisualScope("First", 2);
    using var waiting = new StarVisualScope("Waiting", 1);

    scope.Manager.Register(first.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);
    scope.Manager.Register(waiting.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);

    Assert.That(waiting.Root.GetComponentsInChildren<BuildingCallout>(true), Is.Empty);

    scope.Manager.Register(first.Visual, wantsVisible: false, highlightState: LabelHighlightState.Normal);

    Assert.That(first.Root.GetComponentsInChildren<BuildingCallout>(true), Is.Empty);
    Assert.That(waiting.Root.GetComponentsInChildren<BuildingCallout>(true), Is.Empty);
  }

  [Test]
  public void Register_ActiveCallouts_ApplyCurrentHighlightState()
  {
    using var scope = new BuildingManagerScope(calloutBudget: 2, startManager: false);
    using var visual = new StarVisualScope("Highlighted", 1);
    Material normalMaterial = LoadMaterial("Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF - Drop Shadow.mat");
    Material focusedMaterial = LoadMaterial("Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF - Bloom.mat");
    Material linkedMaterial = LoadMaterial("Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF - Bloom Medium.mat");

    SetCalloutHighlightMaterials(scope.Prefab, normalMaterial, focusedMaterial, linkedMaterial);
    scope.Start();

    scope.Manager.Register(visual.Visual, wantsVisible: true, highlightState: LabelHighlightState.Focused);
    TMP_Text text = visual.Root.GetComponentInChildren<TMP_Text>(true);

    Assert.That(text, Is.Not.Null);
    Assert.That(text.fontSharedMaterial, Is.SameAs(focusedMaterial));

    scope.Manager.Register(visual.Visual, wantsVisible: true, highlightState: LabelHighlightState.Linked);

    Assert.That(text.fontSharedMaterial, Is.SameAs(linkedMaterial));

  }

  [Test]
  public void SyncBuildings_DistantLinkedStarStaysHidden()
  {
    using var cartographer = new CartographerScope(ScapeView.Buildings);
    using var scope = new BuildingManagerScope(calloutBudget: 2);
    using var visual = new StarVisualScope("DistantLinked", 1);

    SetPrivateField(visual.Visual, "currentView", ScapeView.Buildings);
    visual.VisibilitySource.SetHighlightState(LabelHighlightState.Linked);
    InvokePrivate(visual.Visual, "SyncBuildings");

    Assert.That(visual.Root.GetComponentsInChildren<BuildingCallout>(true), Is.Empty);
  }

  [Test]
  public void SyncBuildings_NearbyLinkedStarUsesLinkedStyle()
  {
    using var cartographer = new CartographerScope(ScapeView.Buildings);
    using var scope = new BuildingManagerScope(calloutBudget: 1, startManager: false);
    using var visual = new StarVisualScope("NearbyLinked", 1);
    Material normalMaterial = LoadMaterial("Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF - Drop Shadow.mat");
    Material focusedMaterial = LoadMaterial("Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF - Bloom.mat");
    Material linkedMaterial = LoadMaterial("Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF - Bloom Medium.mat");

    SetCalloutHighlightMaterials(scope.Prefab, normalMaterial, focusedMaterial, linkedMaterial);
    scope.Start();
    SetPrivateField(visual.Visual, "currentView", ScapeView.Buildings);
    visual.VisibilitySource.SetDistanceVisible(visual.Star, true);
    visual.VisibilitySource.SetHighlightState(LabelHighlightState.Linked);
    InvokePrivate(visual.Visual, "SyncBuildings");

    TMP_Text text = visual.Root.GetComponentInChildren<TMP_Text>(true);
    Assert.That(text, Is.Not.Null);
    Assert.That(text.fontSharedMaterial, Is.SameAs(linkedMaterial));
  }

  [Test]
  public void SyncBuildings_DistantFocusedStarOverflowsBudget()
  {
    using var cartographer = new CartographerScope(ScapeView.Buildings);
    using var scope = new BuildingManagerScope(calloutBudget: 0);
    using var visual = new StarVisualScope("DistantFocused", 2);

    SetPrivateField(visual.Visual, "currentView", ScapeView.Buildings);
    visual.VisibilitySource.SetHighlightState(LabelHighlightState.Focused);
    InvokePrivate(visual.Visual, "SyncBuildings");

    Assert.That(visual.Root.GetComponentsInChildren<BuildingCallout>(true), Has.Length.EqualTo(2));
  }

  [Test]
  public void Register_CalloutLifecycle_TogglesLookAtCamera()
  {
    using var cartographer = new CartographerScope(ScapeView.Buildings);
    using var scope = new BuildingManagerScope(calloutBudget: 1);
    using var visual = new StarVisualScope("LookAt", 1);

    scope.Manager.Register(visual.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);
    LookAtCamera lookAtCamera = visual.Root.GetComponentInChildren<LookAtCamera>(true);

    Assert.That(lookAtCamera, Is.Not.Null);
    Assert.That(lookAtCamera.enabled, Is.True);

    scope.Manager.Register(visual.Visual, wantsVisible: false, highlightState: LabelHighlightState.Normal);

    Assert.That(lookAtCamera.enabled, Is.False);
    Assert.That(visual.Root.GetComponentsInChildren<BuildingCallout>(true), Is.Empty);
  }

  [Test]
  public void CalloutLifecycle_ActivatesOnlyAfterPreparation()
  {
    var parent = new GameObject("BuildingManagerEditModeTests_CalloutParent");
    BuildingCallout callout = CreateCalloutPrefab();
    var relatedBehaviour = callout.gameObject.AddComponent<Light>();
    relatedBehaviour.enabled = false;
    SetPrivateField(callout, "relatedBehaviours", new Behaviour[] { relatedBehaviour });

    try
    {
      callout.PrepareForUse(parent.transform);
      callout.Init(new BuildingData { Name = "Prepared" }, sphereRadius: 1f, slotIndex: 0);

      Assert.That(callout.gameObject.activeSelf, Is.False);
      Assert.That(relatedBehaviour.enabled, Is.False);
      Assert.That(callout.GetComponentInChildren<TMP_Text>(true).text, Is.EqualTo("<u>Prepared</u>"));

      callout.Activate();

      Assert.That(callout.gameObject.activeSelf, Is.True);
      Assert.That(relatedBehaviour.enabled, Is.True);

      callout.PrepareForPool(parent.transform);

      Assert.That(callout.gameObject.activeSelf, Is.False);
      Assert.That(relatedBehaviour.enabled, Is.False);
      Assert.That(callout.GetComponentInChildren<TMP_Text>(true).text, Is.Empty);
    }
    finally
    {
      Object.DestroyImmediate(parent);
    }
  }

  [Test]
  public void Clear_ReleasesCalloutsAndLeavesVisualDestructionIndependent()
  {
    using var scope = new BuildingManagerScope(calloutBudget: 1);
    using var visual = new StarVisualScope("Clear", 1);

    SetPrivateField(
      scope.Manager,
      "calloutPool",
      new ObjectPool<BuildingCallout>(
        () => Object.Instantiate(scope.Prefab, scope.Manager.transform),
        null,
        callout => callout.PrepareForPool(scope.Manager.transform),
        callout => Object.DestroyImmediate(callout.gameObject),
        collectionCheck: false,
        defaultCapacity: 1,
        maxSize: 1));

    scope.Manager.Register(visual.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);

    Assert.That(visual.Root.GetComponentInChildren<BuildingCallout>(true), Is.Not.Null);

    Assert.DoesNotThrow(() => scope.Manager.Clear());

    Assert.That(visual.Root.GetComponentsInChildren<BuildingCallout>(true), Is.Empty);
    Assert.That(visual.Root.activeSelf, Is.True);
    Assert.DoesNotThrow(() => Object.DestroyImmediate(visual.RootObject));
  }

  [Test]
  public void ManagerDestroyedBeforeVisual_DoesNotLeaveStaleSingleton()
  {
    using var scope = new BuildingManagerScope(calloutBudget: 1);
    using var visual = new StarVisualScope("Shutdown", 1);

    scope.Manager.Register(visual.Visual, wantsVisible: true, highlightState: LabelHighlightState.Normal);

    Object.DestroyImmediate(scope.ManagerObject);

    Assert.That(BuildingManager.I == null, Is.True);
    Assert.DoesNotThrow(() => Object.DestroyImmediate(visual.RootObject));
  }

  private static void SetPrivateField(object target, string fieldName, object value)
  {
    FieldInfo field = target.GetType().GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(field, Is.Not.Null, $"Missing field {fieldName} on {target.GetType().Name}.");
    field.SetValue(target, value);
  }

  private static IDictionary GetStarBuildingState(BuildingManager manager)
  {
    FieldInfo field = typeof(BuildingManager).GetField(
      "buildingsByStar",
      BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(field, Is.Not.Null, "Missing BuildingManager.buildingsByStar.");
    return (IDictionary)field.GetValue(manager);
  }

  private static void InvokePrivate(object target, string methodName)
  {
    MethodInfo method = target.GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(method, Is.Not.Null, $"Missing method {methodName} on {target.GetType().Name}.");
    method.Invoke(target, null);
  }

  private static void SetCalloutHighlightMaterials(
    BuildingCallout callout,
    Material normalMaterial,
    Material focusedMaterial,
    Material linkedMaterial)
  {
    FieldInfo field = typeof(BuildingCallout).GetField(
      "highlightPresenter",
      BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(field, Is.Not.Null, "Missing BuildingCallout.highlightPresenter.");

    var highlightPresenter = (LabelHighlightPresenter)field.GetValue(callout);
    if (highlightPresenter == null)
    {
      highlightPresenter = callout.gameObject.AddComponent<LabelHighlightPresenter>();
      SetSerializedObjectReference(callout, "highlightPresenter", highlightPresenter);
    }

    SetSerializedObjectReference(highlightPresenter, "normalMaterialPreset", normalMaterial);
    SetSerializedObjectReference(highlightPresenter, "focusedMaterialPreset", focusedMaterial);
    SetSerializedObjectReference(highlightPresenter, "linkedMaterialPreset", linkedMaterial);
  }

  private static void SetSerializedObjectReference(Object target, string propertyName, Object value)
  {
    var serializedObject = new SerializedObject(target);
    SerializedProperty property = serializedObject.FindProperty(propertyName);
    Assert.That(property, Is.Not.Null, $"Missing serialized property {propertyName} on {target.GetType().Name}.");
    property.objectReferenceValue = value;
    serializedObject.ApplyModifiedPropertiesWithoutUndo();

    FieldInfo field = target.GetType().GetField(propertyName, BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(field, Is.Not.Null, $"Missing field {propertyName} on {target.GetType().Name}.");
    field.SetValue(target, value);
  }

  private static Material LoadMaterial(string path)
  {
    Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
    Assert.That(material, Is.Not.Null, $"Missing test material at {path}.");
    return material;
  }

  private static BuildingCallout CreateCalloutPrefab()
  {
    var root = new GameObject("BuildingManagerEditModeTests_CalloutPrefab");
    var callout = root.AddComponent<BuildingCallout>();
    var highlightPresenter = root.AddComponent<LabelHighlightPresenter>();
    var lineRenderer = root.AddComponent<LineRenderer>();
    var marker = new GameObject("Marker").transform;
    var content = new GameObject("Content").transform;
    var lookAtCamera = content.gameObject.AddComponent<LookAtCamera>();
    var text = new GameObject("NameText").AddComponent<TextMeshPro>();

    marker.SetParent(root.transform, false);
    content.SetParent(root.transform, false);
    text.transform.SetParent(content, false);
    lookAtCamera.enabled = false;

    SetSerializedObjectReference(callout, "lineRenderer", lineRenderer);
    SetSerializedObjectReference(callout, "buildingMarker", marker);
    SetSerializedObjectReference(callout, "contentRoot", content);
    SetSerializedObjectReference(callout, "nameText", text);
    SetSerializedObjectReference(callout, "highlightPresenter", highlightPresenter);
    SetPrivateField(callout, "relatedBehaviours", new Behaviour[] { lookAtCamera });
    SetPrivateField(callout, "directionSlotCount", 16);

    root.SetActive(false);
    return callout;
  }

  private sealed class BuildingManagerScope : System.IDisposable
  {
    public BuildingManagerScope(int calloutBudget, bool startManager = true)
    {
      ManagerObject = new GameObject("BuildingManagerEditModeTests_Manager");
      ManagerObject.SetActive(false);
      Prefab = CreateCalloutPrefab();
      Manager = ManagerObject.AddComponent<BuildingManager>();

      SetPrivateField(Manager, "buildingPrefab", Prefab);
      SetPrivateField(Manager, "calloutBudget", calloutBudget);
      if (startManager)
        Start();
    }

    public GameObject ManagerObject { get; }
    public BuildingManager Manager { get; }
    public BuildingCallout Prefab { get; }

    public void Start()
      => StartManager(Manager);

    public void Dispose()
    {
      if (ManagerObject != null)
        Object.DestroyImmediate(ManagerObject);

      if (Prefab != null)
        Object.DestroyImmediate(Prefab.gameObject);
    }
  }

  private static void StartManager(BuildingManager manager)
  {
    MethodInfo awakeMethod = typeof(BuildingManager).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(awakeMethod, Is.Not.Null, "Missing BuildingManager.Awake.");
    awakeMethod.Invoke(manager, null);
  }

  private static void SetCartographerSingleton(Cartographer value)
  {
    FieldInfo singletonBackingField =
      typeof(Cartographer).GetField("<I>k__BackingField", BindingFlags.Static | BindingFlags.NonPublic);
    Assert.That(singletonBackingField, Is.Not.Null, "Missing Cartographer singleton backing field.");
    singletonBackingField.SetValue(null, value);
  }

  private sealed class CartographerScope : System.IDisposable
  {
    public CartographerScope(ScapeView currentView)
    {
      SetCartographerSingleton(null);
      CartographerObject = new GameObject("BuildingManagerEditModeTests_Cartographer");
      Cartographer = CartographerObject.AddComponent<Cartographer>();
      SetPrivateField(Cartographer, "<CurrentView>k__BackingField", currentView);
      SetCartographerSingleton(Cartographer);
    }

    public GameObject CartographerObject { get; }
    public Cartographer Cartographer { get; }

    public void Dispose()
    {
      SetCartographerSingleton(null);

      if (CartographerObject != null)
        Object.DestroyImmediate(CartographerObject);
    }
  }

  private sealed class StarVisualScope : System.IDisposable
  {
    public StarVisualScope(string name, int buildingCount)
    {
      RootObject = new GameObject($"BuildingManagerEditModeTests_{name}");
      var sphereObject = new GameObject("Sphere");
      var buildingRoot = new GameObject("Buildings");

      sphereObject.transform.SetParent(RootObject.transform, false);
      buildingRoot.transform.SetParent(RootObject.transform, false);
      buildingRoot.SetActive(true);

      Star = RootObject.AddComponent<Star>();
      VisibilitySource = RootObject.AddComponent<NodeVisibility>();
      Visual = RootObject.AddComponent<StarVisual>();
      SphereRenderer = sphereObject.AddComponent<MeshRenderer>();
      Root = buildingRoot;

      Star.SetData(new NoteData
      {
        Id = name,
        Name = name,
        Path = $"{name}.md",
        Buildings = BuildBuildings(buildingCount)
      });

      SetPrivateField(Visual, "star", Star);
      SetPrivateField(Visual, "visibilitySource", VisibilitySource);
      SetPrivateField(Visual, "sphereRenderer", SphereRenderer);
      SetPrivateField(Visual, "buildings", Root);
    }

    public GameObject RootObject { get; }
    public Star Star { get; }
    public NodeVisibility VisibilitySource { get; }
    public StarVisual Visual { get; }
    public Renderer SphereRenderer { get; }
    public GameObject Root { get; }

    public void Dispose()
    {
      if (RootObject != null)
        Object.DestroyImmediate(RootObject);
    }

    private static List<BuildingData> BuildBuildings(int count)
    {
      var buildings = new List<BuildingData>(count);
      for (int i = 0; i < count; i++)
        buildings.Add(new BuildingData { Name = $"Building {i + 1}" });

      return buildings;
    }
  }
}
