using System;
using UnityEngine;

[Serializable]
public class Node
{
  /// <summary>
  /// Note node
  /// </summary>
  public Star star;
  /// <summary>
  /// Tag node
  /// </summary>
  public TagNode tagNode;         

  /// <summary>
  /// Node transform
  /// </summary>
  public Transform t;                 

  /// <summary>
  /// Velocity
  /// </summary>
  public Vector3 v;                      

  /// <summary>
  /// Mass (tags can be heavier)
  /// </summary>
  public float mass = 1f;                
}

[Serializable]
public struct Edge
{
  /// <summary>
  /// Index of note node
  /// </summary>
  public int noteInd;

  /// <summary>
  /// Index of Tag node
  /// </summary>
  public int tagInd;       

  /// <summary>
  /// Target edge length
  /// </summary>
  public float restLen; 
}
