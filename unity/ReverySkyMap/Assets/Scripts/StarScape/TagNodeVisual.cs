using TMPro;
using UnityEngine;

public class TagNodeVisual : MonoBehaviour
{
  [SerializeField] private TagNode tagNode;
  [SerializeField] private TextMeshPro tagText;

  public void Start()
  {
    ResetVisual();
    if (tagText != null && tagNode != null)
    {
      var runtimeName = MapRuntimeContext.GetTagName(tagNode.UserTagId);
      tagText.text = string.IsNullOrWhiteSpace(runtimeName) ? $"Tag {tagNode.UserTagId}" : runtimeName;
    }
  }

  public void ResetVisual()
  {
    tagText.text = string.Empty;
  }

}
