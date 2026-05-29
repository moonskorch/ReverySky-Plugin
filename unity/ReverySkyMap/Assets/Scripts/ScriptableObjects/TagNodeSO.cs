using UnityEngine;

[CreateAssetMenu()]
public class TagNodeSO : ScriptableObject
{
  [SerializeField] private GameObject prefab;

  public GameObject Prefab => prefab;
}
