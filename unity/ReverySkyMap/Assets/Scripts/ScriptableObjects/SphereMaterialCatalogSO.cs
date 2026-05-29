using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu()]
public class SphereMaterialCatalogSO : ScriptableObject
{
  public List<SphereType_Material> materials = new();
  public Material defaultMaterial;
}
