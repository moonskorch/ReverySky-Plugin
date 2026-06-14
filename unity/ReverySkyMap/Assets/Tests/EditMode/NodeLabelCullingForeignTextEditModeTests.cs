using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using TMPro;
using UnityEngine;

public class NodeLabelCullingForeignTextEditModeTests
{
  [TestCase("Заметка о звездах")]
  [TestCase("中文节点")]
  public void HiddenLabelRoot_HidesForeignTextAndFallbackChildren(string labelText)
  {
    GameObject managerObject = new GameObject("NodeLabelCullingForeignTextManager");
    GameObject nodeObject = new GameObject("NodeLabelCullingForeignTextNode");
    GameObject labelRoot = new GameObject("ForeignTextRoot");
    GameObject textObject = new GameObject("ForeignText");
    GameObject fallbackRendererObject = new GameObject("FallbackSubmeshProbe");

    try
    {
      managerObject.SetActive(false);
      NodeLabelCullingManager manager = managerObject.AddComponent<NodeLabelCullingManager>();

      labelRoot.transform.SetParent(nodeObject.transform, false);
      textObject.transform.SetParent(labelRoot.transform, false);
      fallbackRendererObject.transform.SetParent(textObject.transform, false);
      fallbackRendererObject.AddComponent<MeshRenderer>();

      TextMeshPro text = textObject.AddComponent<TextMeshPro>();
      text.text = labelText;

      int index = AddEntry(manager, nodeObject.transform, labelRoot);

      InvokeApplyVisibility(manager, index, false);

      Assert.That(labelRoot.activeSelf, Is.False);
      Assert.That(textObject.activeInHierarchy, Is.False);
      Assert.That(fallbackRendererObject.activeInHierarchy, Is.False);
    }
    finally
    {
      Object.DestroyImmediate(fallbackRendererObject);
      Object.DestroyImmediate(textObject);
      Object.DestroyImmediate(labelRoot);
      Object.DestroyImmediate(nodeObject);
      Object.DestroyImmediate(managerObject);
    }
  }

  private static int AddEntry(NodeLabelCullingManager manager, Transform referenceTransform, GameObject labelRoot)
  {
    FieldInfo entriesField = typeof(NodeLabelCullingManager).GetField(
      "entries",
      BindingFlags.Instance | BindingFlags.NonPublic);

    Assert.That(entriesField, Is.Not.Null, "NodeLabelCullingManager.entries was not found.");

    var entries = (List<NodeLabelCullingManager.Entry>)entriesField.GetValue(manager);
    entries.Add(new NodeLabelCullingManager.Entry
    {
      referenceTransform = referenceTransform,
      labelRoot = labelRoot,
      radius = 1f,
      visibleDistance = 1f
    });

    return entries.Count - 1;
  }

  private static void InvokeApplyVisibility(NodeLabelCullingManager manager, int index, bool visible)
  {
    MethodInfo method = typeof(NodeLabelCullingManager).GetMethod(
      "ApplyVisibility",
      BindingFlags.Instance | BindingFlags.NonPublic);

    Assert.That(method, Is.Not.Null, "NodeLabelCullingManager.ApplyVisibility was not found.");
    method.Invoke(manager, new object[] { index, visible });
  }
}
