using UnityEngine;

public class FocusNode : MonoBehaviour
{
  [SerializeField] Transform layoutParent;
  [SerializeField] private CameraOrbitalController cameraController;
  [SerializeField] private float selectedDistance = 5.0f;
  [SerializeField] private FocusHighlighter highlighter;

  private MapGraphNode selectedNode;
  public MapGraphNode SelectedNode => selectedNode;

  public string FocusRestoreNoteId = string.Empty;
  public CameraOrbitalController CameraController => cameraController;

  private void Start()
  {
    GameInput.Instance.OnSelect += HandleSelect;
  }

  private void HandleSelect(Vector2 screenPosition)
  {
    Ray ray = Camera.main.ScreenPointToRay(screenPosition);
    bool isHit = Physics.Raycast(
      ray,
      out RaycastHit hit,
      Camera.main.farClipPlane,
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
