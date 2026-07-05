using System;
using UnityEngine;

[Serializable]
public class CrystalType_ScaleMultiplier
{
  public CrystalType crystalType;
  [Min(0f)] public float scaleMultiplier = 1f;
}
