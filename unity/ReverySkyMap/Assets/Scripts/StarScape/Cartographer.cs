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

  [Header("Change view button")]
  [SerializeField] private ChangeViewControl changeViewControl;
  [SerializeField] private Image viewButtonImage;
  [SerializeField] private Sprite viewIconPlanets;
  [SerializeField] private Sprite viewIconSimple;

  [Header("Notification")]
  [SerializeField] private Notification notification;

  [Header("Debug sample data")]
  [SerializeField] private SampleDataGenerator sampleDataGenerator;

  private ScapeView currentView = ScapeView.Planets;
  public ScapeView CurrentView => currentView;

  public float BoundRadius => _activeEngine != null ? _activeEngine.BoundRadius : 10f;
  public Vector3 Pivot => _activeEngine != null ? _activeEngine.Pivot : transform.position;

  private ICartographerEngine _dynamicLinksEngine;
  private ICartographerEngine _datesEngine;
  private ICartographerEngine _scalableLinksEngine;
  private ICartographerEngine _activeEngine;

  public ICartographerEngine ActiveEngine => _activeEngine;
  public ICartographerEngine StaticSlotEngine => _scalableLinksEngine;
  public Cartographer25DEngine Static25DEngine => (Cartographer25DEngine)_datesEngine;

  public event Action<MapLayoutMode> OnEngineChanged;

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
    RebuildGraph(MapRuntimeContext.MapLayoutPreference);

    MapRuntimeContext.OnNotesChanged += HandleRuntimeNotesChanged;
    if (changeViewControl != null)
      changeViewControl.OnChangeScapeView += CycleView;

    UpdateViewButtonIcon();
    if (focusNode != null && focusNode.CameraController != null)
      focusNode.CameraController.UpdateDateSlider();
  }

  private void OnDestroy()
  {
    MapRuntimeContext.OnNotesChanged -= HandleRuntimeNotesChanged;
    if (changeViewControl != null)
      changeViewControl.OnChangeScapeView -= CycleView;
  }

  private void Update()
  {
    if (_activeEngine != null && _activeEngine.RequiresTick)
      _activeEngine.Tick(Time.deltaTime);
  }

  private void RebuildGraph(MapLayoutMode layoutPreference)
  {
    var noteList = MapRuntimeContext.Notes ?? new List<NoteData>();

    var noEntriesMessage = GameSettings.NotificationNoStars;

    if (notification != null)
    {
      notification.UpdateNoticeMessage(
        noteList.Count == 0,
        noEntriesMessage);
    }

    SetCurrentView(CurrentView);
    BuildGraph(noteList, layoutPreference);
    SetCameraFocus(noteList);
  }

  private void BuildGraph(List<NoteData> notes, MapLayoutMode layoutPreference)
  {
    var engine = ResolveModeByNotesCount(notes.Count, layoutPreference);
    SwitchEngine(engine);

    if (_activeEngine == null) 
    {
      Debug.LogError("No active engine");
      return;
    }

    var stopwatch = System.Diagnostics.Stopwatch.StartNew();
    _activeEngine.BuildGraph(notes);
    _activeEngine.ApplyView(CurrentView);

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

  private void SwitchEngine(MapLayoutMode resolvedMode)
  {
    var next = resolvedMode switch
    {
      MapLayoutMode.Dates => _datesEngine,
      MapLayoutMode.ScalableLinks => _scalableLinksEngine,
      _ => _dynamicLinksEngine
    };
    if (next == null) return;

    if (_activeEngine != null && _activeEngine != next) 
    {
      _activeEngine.ClearGraph();
      OnEngineChanged?.Invoke(next.EngineType);
    }

    _activeEngine = next;
  }

  private void CycleView()
  {
    currentView = ScapeViewHelper.CycleView(CurrentView);
    UpdateViewButtonIcon();
    _activeEngine?.ApplyView(CurrentView);
  }

  private void SetCameraFocus(List<NoteData> visibleNotes)
  {
    if (visibleNotes == null || visibleNotes.Count == 0)
    {
      focusNode?.ResetFocus();
      return;
    }

    var previousFocusId = focusNode?.LastSelectedStarId;
    if (string.IsNullOrWhiteSpace(previousFocusId))
    {
      focusNode?.ResetFocus();
      return;
    }

    foreach (var note in visibleNotes)
    {
      if (note == null || string.IsNullOrWhiteSpace(note.Id))
        continue;

      if (string.Equals(note.Id, previousFocusId, StringComparison.Ordinal))
      {
        FocusRuntimeNote(note.Id);
        return;
      }
    }

    focusNode?.ResetFocus();
  }

  public void FocusRuntimeNote(string noteId)
  {
    if (string.IsNullOrWhiteSpace(noteId))
      return;

    var star = _activeEngine?.FindStarByNoteId(noteId);
    if (star == null)
    {
      // Note is in the note list, but node is not instanciated yet
      MapRuntimeContext.PendingFocusNoteId = noteId;
      return;
    }

    StartCoroutine(SetFocusNextFrame(star));
    if (string.Equals(MapRuntimeContext.PendingFocusNoteId, noteId, StringComparison.Ordinal))
      MapRuntimeContext.PendingFocusNoteId = string.Empty;
  }

  private IEnumerator SetFocusNextFrame(Star star)
  {
    yield return null;

    if (star != null && focusNode != null)
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
      _ => viewButtonImage.sprite
    };
  }

  private void HandleRuntimeNotesChanged()
  {
    RebuildGraph(MapRuntimeContext.MapLayoutPreference);
  }
}
