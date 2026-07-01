using System.Collections.Generic;
using UnityEngine;

public sealed class LineBuilder : MonoBehaviour, ICullingConsumer
{
  [SerializeField, Min(0.01f)] private float radius = 1f;
  [SerializeField, Min(0.01f)] private float visibleDistance = 80f;
  [SerializeField] private bool logVisibilityTransitions = true;

  private readonly HashSet<Component> visibleNodes = new();

  public void Rebuild()
  {
    visibleNodes.Clear();
  }

  public bool TryCreateDistanceEntry(Component node, out CullingManager.Entry entry)
  {
    entry = null;

    if (node is not Star && node is not TagNode)
      return false;

    entry = new CullingManager.Entry
    {
      node = node,
      referenceTransform = node.transform,
      consumer = this,
      radius = radius,
      visibleDistance = visibleDistance
    };

    return true;
  }

  public void SetDistanceVisible(Component node, bool visible)
  {
    if (node == null)
      return;

    if (visible)
    {
      if (!visibleNodes.Add(node))
        return;

      LogTransition(node, true);
      return;
    }

    if (!visibleNodes.Remove(node))
      return;

    LogTransition(node, false);
  }

  private void LogTransition(Component node, bool visible)
  {
    if (!logVisibilityTransitions)
      return;

    Debug.Log(
      $"[LineBuilder] {(visible ? "visible" : "hidden")} {DescribeNode(node)} visibleNodes={visibleNodes.Count}");
  }

  private static string DescribeNode(Component node)
  {
    if (node is Star star)
    {
      string noteId = star.Data != null ? star.Data.Id : string.Empty;
      return string.IsNullOrWhiteSpace(noteId) ? "note:<missing>" : $"note:{noteId}";
    }

    if (node is TagNode tagNode)
      return $"tag:{tagNode.UserTagId}";

    return "<unsupported>";
  }
}
