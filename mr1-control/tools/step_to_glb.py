#!/usr/bin/env python3
"""Convert a STEP assembly to a browser-ready binary glTF with OpenCascade."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = PROJECT_ROOT / ".pydeps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))

try:
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.Message import Message_ProgressRange
    from OCP.RWGltf import RWGltf_CafWriter
    from OCP.STEPCAFControl import STEPCAFControl_Reader
    from OCP.TCollection import TCollection_AsciiString, TCollection_ExtendedString
    from OCP.TColStd import TColStd_IndexedDataMapOfStringString
    from OCP.TDF import TDF_LabelSequence
    from OCP.TDocStd import TDocStd_Document
    from OCP.XCAFApp import XCAFApp_Application
    from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ShapeTool
except ModuleNotFoundError as error:
    raise SystemExit(
        "OpenCascade is missing. Install it locally with: "
        "python -m pip install --target .pydeps cadquery-ocp-novtk"
    ) from error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--linear-deflection", type=float, default=0.25)
    parser.add_argument("--angular-deflection", type=float, default=0.4)
    return parser.parse_args()


def bounds_for(shape) -> dict[str, list[float]]:
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    minimum_x, minimum_y, minimum_z, maximum_x, maximum_y, maximum_z = box.Get()
    minimum = [minimum_x, minimum_y, minimum_z]
    maximum = [maximum_x, maximum_y, maximum_z]
    return {
        "minimum": minimum,
        "maximum": maximum,
        "size": [maximum[index] - minimum[index] for index in range(3)],
    }


def main() -> None:
    args = parse_args()
    source = args.input.resolve()
    destination = args.output.resolve()
    if not source.is_file():
        raise SystemExit(f"STEP file not found: {source}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()

    application = XCAFApp_Application.GetApplication_s()
    document = TDocStd_Document(TCollection_ExtendedString("BinXCAF"))
    application.NewDocument(TCollection_ExtendedString("BinXCAF"), document)

    reader = STEPCAFControl_Reader()
    reader.SetColorMode(True)
    reader.SetNameMode(True)
    status = reader.ReadFile(str(source))
    if status != IFSelect_RetDone:
        raise SystemExit(f"OpenCascade could not read {source}: {status}")
    if not reader.Transfer(document, Message_ProgressRange()):
        raise SystemExit(f"OpenCascade could not transfer {source}")

    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(document.Main())
    free_labels = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free_labels)
    if free_labels.IsEmpty():
        raise SystemExit(f"No free shapes found in {source}")

    model_bounds = []
    for index in range(1, free_labels.Length() + 1):
        shape = XCAFDoc_ShapeTool.GetShape_s(free_labels.Value(index))
        if shape.IsNull():
            continue
        model_bounds.append(bounds_for(shape))
        mesher = BRepMesh_IncrementalMesh(
            shape,
            args.linear_deflection,
            False,
            args.angular_deflection,
            True,
        )
        if not mesher.IsDone():
            raise SystemExit(f"Meshing failed for free shape {index} in {source}")

    writer = RWGltf_CafWriter(TCollection_AsciiString(str(destination)), True)
    writer.SetParallel(True)
    writer.SetMergeFaces(True)
    file_info = TColStd_IndexedDataMapOfStringString()
    if not writer.Perform(document, file_info, Message_ProgressRange()):
        raise SystemExit(f"glTF export failed for {source}")

    report = {
        "source": str(source),
        "output": str(destination),
        "outputBytes": destination.stat().st_size,
        "freeShapes": free_labels.Length(),
        "boundsMillimeters": model_bounds,
        "linearDeflection": args.linear_deflection,
        "angularDeflection": args.angular_deflection,
        "elapsedSeconds": round(time.monotonic() - started, 3),
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
