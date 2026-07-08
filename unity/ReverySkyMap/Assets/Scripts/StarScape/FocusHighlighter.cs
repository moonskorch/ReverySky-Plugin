using UnityEngine;

public sealed class FocusHighlighter : MonoBehaviour
{
  [SerializeField] private LineBuilder lineBuilder;
  [ColorUsage(true, true)]
  [SerializeField] private Color focusedLineColor = Color.cyan;

  private MapGraphNodeId focusedNodeId = MapGraphNodeId.None;

  public void SetFocus(MapGraphNode focusedNode)
  {
    MapGraphNodeId nextFocusedNodeId = focusedNode != null ? focusedNode.Id : MapGraphNodeId.None;
    if (focusedNodeId.Equals(nextFocusedNodeId))
      return;

    MapGraphNodeId previousFocusedNodeId = focusedNodeId;
    focusedNodeId = nextFocusedNodeId;
    lineBuilder?.ApplyFocusHighlightChange(previousFocusedNodeId, focusedNodeId, focusedLineColor);
  }
}
