using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class Cartographer : MonoBehaviour
{
  public static Cartographer I { get; private set; }

  [SerializeField] private FocusNode focusNode;

  [Header("Engines")]
  [SerializeField] private MonoBehaviour dynamicLinksEngineBehaviour;
  [SerializeField] private MonoBehaviour datesEngineBehaviour;
  [SerializeField] private MonoBehaviour scalableLinksEngineBehaviour;
  [SerializeField] private MapLayoutMode defaultEngine = MapLayoutMode.Auto;

  [Tooltip("Auto/Forces: large graphs use the static-slot engine; small graphs use Forces. Static25D and StaticLinks stay explicit.")]
  [SerializeField] private int autoSwitchThreshold = 500;
  public int AutoSwitchThreshold => autoSwitchThreshold;

  [Header("Change view button")]
  [SerializeField] private ChangeViewControl changeViewControl;
  [SerializeField] private Image viewButtonImage;
  [SerializeField] private Sprite viewIconPlanets;
  [SerializeField] private Sprite viewIconSimple;
  [SerializeField] private Sprite viewIconBuildings;

  [Header("Notification")]
  [SerializeField] private Notification notification;

  [Header("Debug sample data")]
  [SerializeField] private SampleDataGenerator sampleDataGenerator;
  [SerializeField] private LineBuilder lineBuilder;
  [SerializeField] private CullingManager cullingManager;

  [Header("Visual Effects")]
  [SerializeField] private StarPulseAnimator starPulseAnimator;

  private ScapeView currentView = ScapeView.Planets;
  public ScapeView CurrentView => currentView;

  public float BoundRadius => _activeEngine != null ? _activeEngine.BoundRadius : 10f;
  public Vector3 Pivot => _activeEngine != null ? _activeEngine.Pivot : transform.position;

  private ICartographerEngine _dynamicLinksEngine;
  private ICartographerEngine _datesEngine;
  private ICartographerEngine _scalableLinksEngine;
  private ICartographerEngine _activeEngine;
  private ScapeCameraWarper _activeWarper;
  private Coroutine rebuildGraphCoroutine;

  public ICartographerEngine ActiveEngine => _activeEngine;
  public ICartographerEngine StaticSlotEngine => _scalableLinksEngine;
  public Cartographer25DEngine Static25DEngine => (Cartographer25DEngine)_datesEngine;
  public MapGraphIndex GraphIndex { get; private set; } = MapGraphIndex.Empty;

  public event Action<MapLayoutMode> OnEngineChanged;
  public event Action<ScapeView> OnViewChanged;

  private void Awake()
  {
    if (I != null) 
      Debug.LogError("More than one instance of Cartographer");
    I = this;

    _dynamicLinksEngine = dynamicLinksEngineBehaviour as ICartographerEngine;
    _datesEngine = datesEngineBehaviour as ICartographerEngine;
    _scalableLinksEngine = scalableLinksEngineBehaviour as ICartographerEngine;
  }

  private void Start()
  {
#if UNITY_EDITOR
    sampleDataGenerator?.TryInjectSampleDataIfNeeded();
#endif
    RebuildGraph(MapRuntimeContext.MapLayoutPreference, MapRuntimeContext.LatestGraphRequestId);

    MapRuntimeContext.OnNotesChanged += HandleRuntimeNotesChanged;
    MapRuntimeContext.OnNoteBuildingsChanged += HandleNoteBuildingsChanged;
    if (changeViewControl != null)
      changeViewControl.OnChangeScapeView += CycleView;

    UpdateViewButtonIcon();
    focusNode.CameraController.UpdateDateSlider();
  }

  private void OnDestroy()
  {
    MapRuntimeContext.OnNotesChanged -= HandleRuntimeNotesChanged;
    MapRuntimeContext.OnNoteBuildingsChanged -= HandleNoteBuildingsChanged;
    if (changeViewControl != null)
      changeViewControl.OnChangeScapeView -= CycleView;

    if (_activeEngine != null)
      _activeEngine.OnNodesChanged -= HandleEngineNodesChanged;

    if (rebuildGraphCoroutine != null)
      StopCoroutine(rebuildGraphCoroutine);

    MapRuntimeContext.ClearBuildingGraphRequestId();
    BindActiveWarper(null);
  }

  private void Update()
  {
    if (_activeEngine != null && _activeEngine.RequiresTick)
    {
      _activeEngine.Tick(Time.deltaTime);
      cullingManager?.RefreshTargets();
    }
  }

  private void RebuildGraph(MapLayoutMode layoutPreference, string requestId)
  {
    if (rebuildGraphCoroutine != null)
      StopCoroutine(rebuildGraphCoroutine);

    rebuildGraphCoroutine = StartCoroutine(RebuildGraphAfterClear(layoutPreference, requestId));
  }

  private IEnumerator RebuildGraphAfterClear(MapLayoutMode layoutPreference, string requestId)
  {
    int noteCount = MapRuntimeContext.Notes?.Count ?? 0;

    PrepareGraphClear(noteCount, layoutPreference);
    yield return null;

    BuildClearedGraph(MapRuntimeContext.Notes ?? new List<NoteData>(), requestId);
    rebuildGraphCoroutine = null;
  }

  private void PrepareGraphClear(int noteCount, MapLayoutMode layoutPreference)
  {
    var noEntriesMessage = GameSettings.NotificationNoStars;

    if (notification != null)
    {
      notification.UpdateNoticeMessage(
        noteCount == 0,
        noEntriesMessage);
    }

    SetCurrentView(CurrentView);
    MapRuntimeContext.ClearBuildingGraphRequestId();

    var engine = ResolveModeByNotesCount(noteCount, layoutPreference);
    SwitchEngine(engine);
    ApplyGraphIndex(MapGraphIndex.Empty, updateFocus: noteCount == 0);
  }

  private void BuildClearedGraph(List<NoteData> notes, string requestId)
  {
    MapRuntimeContext.SetBuildingGraphRequestId(requestId);
    var stopwatch = System.Diagnostics.Stopwatch.StartNew();
    _activeEngine.BuildGraph(notes);
    ApplyCurrentView();

    var warper = _activeEngine.ScapeWarper;
    warper?.ApplyEngineProfile(_activeEngine.EngineType);
    warper?.Rebind(_activeEngine);
    stopwatch.Stop();

    Debug.Log(
      $"[Cartographer] Graph built in {stopwatch.Elapsed.TotalMilliseconds:F1} ms (notes={notes.Count}, engine={_activeEngine.EngineType})");
  }

  private MapLayoutMode ResolveModeByNotesCount(int notesCount, MapLayoutMode layoutPreference)
  {
    if (defaultEngine != MapLayoutMode.Auto)
      return defaultEngine;

    if (layoutPreference == MapLayoutMode.Dates || layoutPreference == MapLayoutMode.ScalableLinks)
      return layoutPreference;

    var isLargeGraph = notesCount > autoSwitchThreshold;
    return isLargeGraph
      ? MapLayoutMode.ScalableLinks
      : MapLayoutMode.DynamicLinks;
  }

  /// <summary>
  /// Switches to the requested engine and clears only the engine that currently owns stale graph visuals.
  /// </summary>
  /// <param name="resolvedMode"></param>
  private void SwitchEngine(MapLayoutMode resolvedMode)
  {
    var next = resolvedMode switch
    {
      MapLayoutMode.Dates => _datesEngine,
      MapLayoutMode.ScalableLinks => _scalableLinksEngine,
      _ => _dynamicLinksEngine
    };

    if (_activeEngine == next)
    {
      _activeEngine.ClearGraph();
      return;
    }

    if (_activeEngine != null) 
    {
      _activeEngine.OnNodesChanged -= HandleEngineNodesChanged;
      BindActiveWarper(null);
      _activeEngine.ClearGraph();
      OnEngineChanged?.Invoke(next.EngineType);
    }

    _activeEngine = next;
    _activeEngine.OnNodesChanged += HandleEngineNodesChanged;
    BindActiveWarper(_activeEngine.ScapeWarper);
  }

  private void CycleView()
  {
    currentView = ScapeViewHelper.CycleView(CurrentView);
    UpdateViewButtonIcon();
    ApplyCurrentView();
  }

  public void FocusRuntimeNote(string noteId)
  {
    // A bridge focus miss does not mean "focus this someday"; it means the
    // current runtime may still be materializing the accepted graph.
    if (!TryFocusRuntimeNote(noteId))
      MapRuntimeContext.PendingFocusNoteId = noteId;
  }

  private bool TryFocusRuntimeNote(string noteId)
  {
    if (string.IsNullOrWhiteSpace(noteId) || !GraphIndex.TryGetStar(noteId, out var star))
      return false;

    // Focus is intentionally deferred one frame so graph publication settles before camera focus.
    // An unrelated graph rebuild during that frame can invalidate this Star and drop the focus.
    // This narrow race is accepted to keep pending-focus semantics and lifecycle simple.
    StartCoroutine(SetFocusNextFrame(star));
    if (string.Equals(MapRuntimeContext.PendingFocusNoteId, noteId, StringComparison.Ordinal))
      MapRuntimeContext.PendingFocusNoteId = string.Empty;

    return true;
  }

  private IEnumerator SetFocusNextFrame(Star star)
  {
    yield return null;

    if (star != null)
      focusNode.SetSelectedStar(star);
  }

  private void SetCurrentView(ScapeView defaultView)
  {
    currentView = defaultView;

    if (currentView == ScapeView.Undefined)
      currentView = ScapeView.Planets;
  }

  private void UpdateViewButtonIcon()
  {
    if (viewButtonImage == null)
      return;

    viewButtonImage.sprite = CurrentView switch
    {
      ScapeView.Planets => viewIconPlanets,
      ScapeView.Plain => viewIconSimple,
      ScapeView.Buildings => viewIconBuildings,
      _ => viewButtonImage.sprite
    };
  }

  private void ApplyCurrentView()
  {
    _activeEngine?.ApplyView(CurrentView);
    OnViewChanged?.Invoke(CurrentView);
    lineBuilder?.SetLinesVisible(CurrentView == ScapeView.Planets);
  }

  private void HandleRuntimeNotesChanged(string requestId)
  {
    RebuildGraph(MapRuntimeContext.MapLayoutPreference, requestId);
  }

  private void HandleNoteBuildingsChanged(string noteId)
  {
    if (string.IsNullOrWhiteSpace(noteId) || !GraphIndex.TryGetStar(noteId, out var star))
      return;

    var visual = star.GetComponentInChildren<StarVisual>(true);
    visual?.RefreshBuildings();
    starPulseAnimator?.Play(visual.transform);
  }

  private void BindActiveWarper(ScapeCameraWarper warper)
  {
    if (_activeWarper == warper)
      return;

    if (_activeWarper != null)
      _activeWarper.OnWarpApplied -= HandleWarpApplied;

    _activeWarper = warper;

    if (_activeWarper != null)
      _activeWarper.OnWarpApplied += HandleWarpApplied;
  }

  private void HandleWarpApplied()
  {
    cullingManager?.RefreshTargets();
  }

  private void HandleEngineNodesChanged(IReadOnlyList<Star> stars, IReadOnlyList<TagNode> tagNodes)
  {
    ApplyGraphIndex(
      MapGraphIndex.Build(stars, tagNodes, MapRuntimeContext.Links),
      updateFocus: !IsTransientEmptyGraph(stars));
  }

  private static bool IsTransientEmptyGraph(IReadOnlyList<Star> stars)
  {
    return MapRuntimeContext.HasRuntimeNotes && (stars == null || stars.Count == 0);
  }

  private void ApplyGraphFocus()
  {
    var pendingFocusNoteId = MapRuntimeContext.PendingFocusNoteId;
    if (!string.IsNullOrWhiteSpace(pendingFocusNoteId))
    {
      // Pending is a newer explicit focus intent than restore, but only for
      // this index publication; a miss falls back to restore instead of waiting forever.
      MapRuntimeContext.PendingFocusNoteId = string.Empty;
      if (TryFocusRuntimeNote(pendingFocusNoteId))
        return;
    }

    var restoreFocusNoteId = focusNode.FocusRestoreNoteId;
    if (!string.IsNullOrWhiteSpace(restoreFocusNoteId) && TryFocusRuntimeNote(restoreFocusNoteId))
      return;

    focusNode.ResetFocus();
  }

  private void ApplyGraphIndex(MapGraphIndex graphIndex, bool updateFocus)
  {
    GraphIndex = graphIndex;
    int activeLineLimit = _activeEngine?.MaxActiveLines ?? 0;
    int activeLongLineLimit = _activeEngine?.MaxActiveLongLines ?? 0;
    lineBuilder?.Rebuild(GraphIndex, activeLineLimit, activeLongLineLimit);
    cullingManager?.Rebuild(GraphIndex, lineBuilder);

    if (updateFocus)
      ApplyGraphFocus();
  }
}
