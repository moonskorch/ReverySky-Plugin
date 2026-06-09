using UnityEngine;

public class TagNode : MonoBehaviour
{
  [SerializeField] private TagNodeSO tagNodeSO;
  public int UserTagId { get; set; }

  public static TagNode Create(TagNodeSO tagNodeTemplate,
  Vector3 worldPosition, int userTagId, Transform parent)
  {
    GameObject go = Instantiate(
      tagNodeTemplate.Prefab,
      worldPosition,
      Quaternion.identity,
      parent);

    var tag = go.GetComponent<TagNode>();
    tag.UserTagId = userTagId;

    return tag;
  }
}
