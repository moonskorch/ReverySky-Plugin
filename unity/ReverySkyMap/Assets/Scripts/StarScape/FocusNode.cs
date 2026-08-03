using UnityEngine;

public class FocusNode : MonoBehaviour
{
  [SerializeField] Transform layoutParent;
  [SerializeField] private CameraOrbitalController cameraController;
  [SerializeField] private float selectedDistance = 5.0f;
  [SerializeField] private FocusHighlighter highlighter;

  private Camera inputCamera;
  private MapGraphNode selectedNode;
  public MapGraphNode SelectedNode => selectedNode;

  /// <summary>
  /// Last successfully focused note id used as long-lived graph-rebuild continuity.
  /// Unlike <see cref="MapRuntimeContext.PendingFocusNoteId"/>, this is not a queued focus request;
  /// Cartographer uses it only as a fallback when no pending focus is waiting.
  /// </summary>
  public string FocusRestoreNoteId = string.Empty;
  public CameraOrbitalController CameraController => cameraController;

  private void Start()
  {
    inputCamera = Camera.main;
    GameInput.Instance.OnSelect += HandleSelect;
  }

  private void HandleSelect(Vector2 screenPosition)
  {
    Ray ray = inputCamera.ScreenPointToRay(screenPosition);
    bool isHit = Physics.Raycast(
      ray,
      out RaycastHit hit,
      inputCamera.farClipPlane,
      GameInput.Instance.InteractableLayers);

    if (!isHit) return;

    Transform tappedObj = hit.transform;
    if (tappedObj.parent != layoutParent) return;

    if (tappedObj.TryGetComponent(out Star star))
    {
      if (!SelectGraphNode(star))
        return;

      FocusSelectedNode();
      MapRuntimeContext.RequestOpenNote(star.Data);
    }

    else if (tappedObj.TryGetComponent(out TagNode tagNode))
    {
      if (SelectGraphNode(tagNode))
        FocusSelectedNode();
    }
  }

  private void FocusSelectedNode()
  {
    if (selectedNode == null || selectedNode.Transform == null)
      return;

    Transform selectedTransform = selectedNode.Transform;
    var nav = Cartographer.I.ActiveEngine;
    Vector3 nodePos =
      (nav != null && nav.TryGetNavigationWorld(selectedTransform, out var p)) ? p
      : selectedTransform.position;

    cameraController.SetActivePivot(selectedTransform);
    cameraController.Focus(nodePos, selectedDistance);
  }

  public void SetSelectedStar(Star star)
  {
    if (star != null && !SelectGraphNode(star))
      return;

    if (star == null)
      SelectNode(null);

    FocusSelectedNode();
  }

  private bool SelectGraphNode(Component component)
  {
    // Resolve through the graph index so focus and LineBuilder use the same node id space.
    var graphIndex = Cartographer.I.GraphIndex;
    if (!graphIndex.TryGetNodeId(component, out var nodeId) ||
        !graphIndex.TryGetNode(nodeId, out var node))
    {
      // TODO: RecursiveHubs stars can be clicked before the final index is built.
      // Fix by publishing index entries incrementally as visible nodes are placed.
      if (graphIndex.IsEmpty)
        return false;

      string componentName = component != null ? component.name : "<null>";
      Debug.LogError($"[FocusNode] Selected component is missing from the graph index: {componentName}");
      return false;
    }

    SelectNode(node);
    return true;
  }

  public void ResetFocus() 
  {
    selectedNode = null;
    ApplyHighlightFocus(null);
    // Keep FocusRestoreNoteId so graph rebuilds can restore note focus continuity.
    cameraController.ResetToStart();
  }

  private void SelectNode(MapGraphNode node)
  {
    selectedNode = node;
    ApplyHighlightFocus(node);

    if (node == null)
      return;

    if (node.Kind == MapGraphNodeKind.Star)
      FocusRestoreNoteId = node.NoteId ?? string.Empty;
    else
      FocusRestoreNoteId = string.Empty;
  }

  private void ApplyHighlightFocus(MapGraphNode node)
  {
    if (highlighter == null)
      return;

    highlighter.SetFocus(node);
  }
}
