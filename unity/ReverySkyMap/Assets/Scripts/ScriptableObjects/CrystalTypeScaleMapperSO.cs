using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu()]
public class CrystalTypeScaleMapperSO : ScriptableObject
{
  public List<CrystalType_ScaleMultiplier> multipliers = new();
  public float defaultScale = 1.0f;
}
