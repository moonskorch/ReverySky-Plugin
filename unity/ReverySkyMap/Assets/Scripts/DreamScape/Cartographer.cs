using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.UI;

public class Cartographer : MonoBehaviour
{
  public static Cartographer I { get; private set; }

  [SerializeField] private FocusNode focusNode;

  [Header("Engines")]
  [SerializeField] private MonoBehaviour forcesEngineBehaviour;
  [SerializeField] private MonoBehaviour static25DEngineBehaviour;
  [SerializeField] private CartographerEngine defaultEngine = CartographerEngine.Auto;

  [Tooltip("Auto: if notes count > threshold => Static25D, else Forces")]
  [SerializeField] private int autoSwitchThreshold = 200;

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

  private ICartographerEngine _forcesEngine;
  private ICartographerEngine _static25dEngine;
  private ICartographerEngine _activeEngine;

  public ICartographerEngine ActiveEngine => _activeEngine;
  public Cartographer25DEngine Static25DEngine => (Cartographer25DEngine)_static25dEngine;

  public event Action<CartographerEngine> OnEngineChanged;

  private void Awake()
  {
    if (I != null) 
      Debug.LogError("More than one instance of Cartographer");
    I = this;

    _forcesEngine = forcesEngineBehaviour as ICartographerEngine;
    _static25dEngine = static25DEngineBehaviour as ICartographerEngine;
  }

  private void Start()
  {
    sampleDataGenerator?.TryInjectSampleDataIfNeeded();
    RebuildGraph(MapRuntimeContext.EnginePreference);

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

  private void RebuildGraph(CartographerEngine enginePreferred)
  {
    var noteList = MapRuntimeContext.Notes ?? new List<NoteData>();

    var noEntriesMessage = GameSettings.NotificationNoStars;

    if (notification != null)
    {
      notification.UpdateNoticeMessage(
        !noteList.Any(),
        noEntriesMessage);
    }

    SetCurrentView(CurrentView);
    BuildGraph(noteList, enginePreferred);
    SetCameraFocus();
  }

  private void BuildGraph(List<NoteData> notes, CartographerEngine enginePreferred)
  {
    var engine = ResolveModeByNotesCount(notes.Count, enginePreferred);
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

  private CartographerEngine ResolveModeByNotesCount(int notesCount, CartographerEngine enginePreferred)
  {
    if (defaultEngine != CartographerEngine.Auto)
      return defaultEngine;

    if (enginePreferred == CartographerEngine.Static25D ||
      (enginePreferred == CartographerEngine.Forces && notesCount < autoSwitchThreshold))
    {
      return enginePreferred;
    }

    return notesCount > autoSwitchThreshold
      ? CartographerEngine.Static25D
      : CartographerEngine.Forces;
  }

  private void SwitchEngine(CartographerEngine resolvedMode)
  {
    var next = (resolvedMode == CartographerEngine.Static25D) ? 
      _static25dEngine : 
      _forcesEngine;
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

  private void SetCameraFocus()
  {
    if (!string.IsNullOrWhiteSpace(MapRuntimeContext.CurrentNoteId))
    {
      var runtimeStar = _activeEngine?.FindStarByNoteId(MapRuntimeContext.CurrentNoteId);
      MapRuntimeContext.CurrentNoteId = string.Empty;
      if (runtimeStar != null)
      {
        StartCoroutine(RestoreFocusNextFrame(runtimeStar));
        return;
      }
    }

    if (!string.IsNullOrEmpty(focusNode.LastSelectedStarId))
    {
      var star = _activeEngine?.FindStarByNoteId(focusNode.LastSelectedStarId);
      if (star != null) 
      {
        StartCoroutine(RestoreFocusNextFrame(star));
        return;
      }
    }
    
    if (focusNode != null)
      focusNode.ResetFocus();
  }

  public void FocusRuntimeNote(string noteId, string notePath)
  {
    var resolvedId = noteId;
    if (string.IsNullOrWhiteSpace(resolvedId))
    {
      var byPath = MapRuntimeContext.FindNoteByPath(notePath);
      resolvedId = byPath?.Id;
    }

    if (string.IsNullOrWhiteSpace(resolvedId))
      return;

    var star = _activeEngine?.FindStarByNoteId(resolvedId);
    if (star != null)
    {
      StartCoroutine(RestoreFocusNextFrame(star));
      return;
    }

    // Fallback for cases where graph rebuild is in-flight and star is not materialized yet.
    MapRuntimeContext.CurrentNoteId = resolvedId;
  }

  private IEnumerator RestoreFocusNextFrame(Star star)
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
    RebuildGraph(MapRuntimeContext.EnginePreference);
  }
}
