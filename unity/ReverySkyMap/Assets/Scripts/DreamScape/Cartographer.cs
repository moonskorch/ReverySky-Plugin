using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.UI;

public class Cartographer : MonoBehaviour
{
  public static Cartographer I { get; private set; }

  [Header("Filter")]
  [SerializeField] private OptionsForm optionsForm;
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

  [Header("Debug")]
  [Tooltip("Inject sample notes only when enabled and no input data is available.")]
  [SerializeField] private bool injectSampleData = false;
  [SerializeField] private int sampleNoteCount = 320;
  [SerializeField] private int sampleTagPoolSize = 24;
  [SerializeField] private int sampleDateSpanDays = 720;
  [SerializeField] private int sampleMaxTagsPerNote = 3;
  [SerializeField] private int sampleExtraLinks = 480;

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
    TryInjectSampleDataIfNeeded();

    BuildGraphRange(
      MapRuntimeContext.FilterRangeDays,
      MapRuntimeContext.FilterImportance,
      MapRuntimeContext.FilterEngine);

    MapRuntimeContext.OnNotesChanged += HandleRuntimeNotesChanged;
    if (optionsForm != null)
      optionsForm.OnFilterApplied += BuildGraphRange;
    if (changeViewControl != null)
      changeViewControl.OnChangeScapeView += CycleView;

    UpdateViewButtonIcon();
    if (focusNode != null && focusNode.CameraController != null)
      focusNode.CameraController.UpdateDateSlider();
  }

  private void TryInjectSampleDataIfNeeded()
  {
    if (!injectSampleData)
      return;

    if (MapRuntimeContext.HasRuntimeNotes)
      return;

    var sampleNotes = BuildSampleNotes(
      sampleNoteCount,
      sampleTagPoolSize,
      sampleDateSpanDays,
      sampleMaxTagsPerNote);
    var links = BuildSampleLinks(sampleNotes, sampleExtraLinks);
    var tagNames = BuildSampleTagNames(sampleTagPoolSize);

    MapRuntimeContext.SetTagNames(tagNames);
    MapRuntimeContext.SetLinks(links);
    MapRuntimeContext.SetNotes(sampleNotes);

    Debug.Log($"[Cartographer] Sample notes injected: {sampleNotes.Count}");
  }

  private static List<NoteData> BuildSampleNotes(
    int requestedCount,
    int requestedTagPoolSize,
    int requestedDateSpanDays,
    int requestedMaxTagsPerNote)
  {
    int noteCount = Mathf.Clamp(requestedCount, 4, 2000);
    int tagPoolSize = Mathf.Clamp(requestedTagPoolSize, 4, 256);
    int dateSpanDays = Mathf.Clamp(requestedDateSpanDays, 30, 3650);
    int maxTagsPerNote = Mathf.Clamp(requestedMaxTagsPerNote, 1, 8);

    var rng = new System.Random(1337);
    var now = DateTime.Now.Date;
    var notes = new List<NoteData>(noteCount);
    var spheres = new[] { SphereType.Blue, SphereType.Green, SphereType.Red, SphereType.Eternal };

    for (int i = 0; i < noteCount; i++)
    {
      int dayIndex = (int)Mathf.Floor((i / Mathf.Max(1f, noteCount - 1f)) * (dateSpanDays - 1f));
      int dayJitter = rng.Next(-2, 3);
      int daysAgo = Mathf.Clamp(dayIndex + dayJitter, 0, dateSpanDays - 1);

      int tagCount = rng.Next(1, maxTagsPerNote + 1);
      var tagSet = new HashSet<int>();
      while (tagSet.Count < tagCount)
      {
        int tagId = 101 + rng.Next(0, tagPoolSize);
        tagSet.Add(tagId);
      }

      int number = i + 1;
      notes.Add(new NoteData
      {
        Id = $"sample-{number:0000}",
        Name = $"{number} Sample Note",
        Path = $"Sample/{number:0000}.md",
        DateTime = now.AddDays(-daysAgo),
        CrystalType = (CrystalType)rng.Next((int)CrystalType.Value1, (int)CrystalType.Value4 + 1),
        SphereType = spheres[rng.Next(0, spheres.Length)],
        TagIds = tagSet.ToList()
      });
    }

    return notes;
  }

  private static List<MapRuntimeContext.RuntimeNoteLink> BuildSampleLinks(
    List<NoteData> notes,
    int requestedExtraLinks)
  {
    var result = new List<MapRuntimeContext.RuntimeNoteLink>();
    if (notes == null || notes.Count < 2)
      return result;

    // Base chain to guarantee connectivity.
    for (int i = 0; i < notes.Count - 1; i++)
    {
      result.Add(new MapRuntimeContext.RuntimeNoteLink
      {
        SourceId = notes[i].Id,
        TargetId = notes[i + 1].Id,
        Weight = 1f
      });
    }

    int extraLinks = Mathf.Clamp(requestedExtraLinks, 0, notes.Count * 8);
    var rng = new System.Random(7331);
    var dedup = new HashSet<string>(StringComparer.Ordinal);

    for (int i = 0; i < notes.Count - 1; i++)
    {
      string a = notes[i].Id;
      string b = notes[i + 1].Id;
      dedup.Add(string.CompareOrdinal(a, b) <= 0 ? $"{a}|{b}" : $"{b}|{a}");
    }

    int created = 0;
    int safety = extraLinks * 12 + 64;
    while (created < extraLinks && safety-- > 0)
    {
      int aIndex = rng.Next(0, notes.Count);
      int bIndex = rng.Next(0, notes.Count);
      if (aIndex == bIndex)
        continue;

      string a = notes[aIndex].Id;
      string b = notes[bIndex].Id;
      string key = string.CompareOrdinal(a, b) <= 0 ? $"{a}|{b}" : $"{b}|{a}";
      if (!dedup.Add(key))
        continue;

      result.Add(new MapRuntimeContext.RuntimeNoteLink
      {
        SourceId = a,
        TargetId = b,
        Weight = 0.75f + ((float)rng.NextDouble() * 1.75f)
      });
      created++;
    }

    return result;
  }

  private static Dictionary<int, string> BuildSampleTagNames(int requestedTagPoolSize)
  {
    int tagPoolSize = Mathf.Clamp(requestedTagPoolSize, 4, 256);
    var tags = new Dictionary<int, string>(tagPoolSize);
    for (int i = 0; i < tagPoolSize; i++)
    {
      int tagId = 101 + i;
      tags[tagId] = $"tag {tagId}";
    }

    return tags;
  }

  private void OnDestroy()
  {
    MapRuntimeContext.OnNotesChanged -= HandleRuntimeNotesChanged;
    if (optionsForm != null)
      optionsForm.OnFilterApplied -= BuildGraphRange;
    if (changeViewControl != null)
      changeViewControl.OnChangeScapeView -= CycleView;
  }

  private void Update()
  {
    if (_activeEngine != null && _activeEngine.RequiresTick)
      _activeEngine.Tick(Time.deltaTime);
  }

  private void BuildGraphRange(int fromDaysAgo, CrystalType importance, CartographerEngine enginePreferred)
  {
    var sourceNotes = MapRuntimeContext.Notes ?? new List<NoteData>();

    var notesFiltered = sourceNotes.AsEnumerable();

    if (importance != CrystalType.Unknown)
      notesFiltered = notesFiltered.Where(x => (int)x.CrystalType >= (int)importance);

    if (fromDaysAgo > 0)
    {
      var threshold = DateTime.Today.AddDays(-fromDaysAgo);
      notesFiltered = notesFiltered.Where(x => x.DateTime >= threshold);
    }

    var noteList = notesFiltered.ToList();

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

    _activeEngine.BuildGraph(notes);
    _activeEngine.ApplyView(CurrentView);

    var warper = _activeEngine.ScapeWarper;
    warper?.ApplyEngineProfile(_activeEngine.EngineType);
    warper?.Rebind(_activeEngine);
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
    BuildGraphRange(
      MapRuntimeContext.FilterRangeDays,
      MapRuntimeContext.FilterImportance,
      MapRuntimeContext.FilterEngine);
  }
}
