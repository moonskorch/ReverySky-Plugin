using System.Collections.Generic;
using UnityEngine;

public sealed class FocusHighlighter : MonoBehaviour
{
  [SerializeField] private LineBuilder lineBuilder;
  [ColorUsage(true, true)]
  [SerializeField] private Color focusedLineColor = Color.cyan;

  private MapGraphNodeId focusedNodeId = MapGraphNodeId.None;
  private readonly Dictionary<MapGraphNodeId, LabelHighlightState> labelStatesByNodeId = new();
  private readonly Dictionary<MapGraphNodeId, LabelHighlightState> nextLabelStatesByNodeId = new();
  private readonly List<MapGraphNodeId> staleLabelNodeIds = new();

  public void SetFocus(MapGraphNode focusedNode)
  {
    SetFocus(focusedNode, Cartographer.I.GraphIndex);
  }

  public void SetFocus(MapGraphNode focusedNode, MapGraphIndex graphIndex)
  {
    MapGraphNodeId nextFocusedNodeId = focusedNode != null ? focusedNode.Id : MapGraphNodeId.None;
    if (focusedNodeId.Equals(nextFocusedNodeId))
      return;

    MapGraphNodeId previousFocusedNodeId = focusedNodeId;
    focusedNodeId = nextFocusedNodeId;
    ApplyHighlight(graphIndex, focusedNodeId);
    lineBuilder?.ApplyHighlight(previousFocusedNodeId, focusedNodeId, focusedLineColor);
  }

  private void ApplyHighlight(MapGraphIndex graphIndex, MapGraphNodeId nextFocusedNodeId)
  {
    BuildNextLabelStates(graphIndex, nextFocusedNodeId);
    ApplyLabelStateDiff(graphIndex);
  }

  private void BuildNextLabelStates(MapGraphIndex graphIndex, MapGraphNodeId nextFocusedNodeId)
  {
    nextLabelStatesByNodeId.Clear();
    if (!nextFocusedNodeId.IsValid)
      return;

    nextLabelStatesByNodeId[nextFocusedNodeId] = LabelHighlightState.Focused;

    IReadOnlyList<MapGraphNodeId> neighborIds = graphIndex.GetNeighborIds(nextFocusedNodeId);
    for (int i = 0; i < neighborIds.Count; i++)
      nextLabelStatesByNodeId[neighborIds[i]] = LabelHighlightState.Linked;
  }

  private void ApplyLabelStateDiff(MapGraphIndex graphIndex)
  {
    staleLabelNodeIds.Clear();
    foreach (MapGraphNodeId nodeId in labelStatesByNodeId.Keys)
    {
      if (!nextLabelStatesByNodeId.ContainsKey(nodeId))
        staleLabelNodeIds.Add(nodeId);
    }

    for (int i = 0; i < staleLabelNodeIds.Count; i++)
    {
      MapGraphNodeId nodeId = staleLabelNodeIds[i];
      SetLabelState(graphIndex, nodeId, LabelHighlightState.Normal);
      labelStatesByNodeId.Remove(nodeId);
    }

    foreach (var pair in nextLabelStatesByNodeId)
    {
      if (labelStatesByNodeId.TryGetValue(pair.Key, out var currentState) &&
          currentState == pair.Value)
      {
        continue;
      }

      SetLabelState(graphIndex, pair.Key, pair.Value);
      labelStatesByNodeId[pair.Key] = pair.Value;
    }
  }

  private static void SetLabelState(MapGraphIndex graphIndex, MapGraphNodeId nodeId, LabelHighlightState state)
  {
    if (!graphIndex.TryGetNode(nodeId, out var node))
      return;

    node.Component.GetComponent<LabelPresenter>().SetHighlightState(state);
  }
}
