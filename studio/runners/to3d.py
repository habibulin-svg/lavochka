"""Картинка → вырезка фона (BiRefNet) → 3D-меш (TripoSG) → .glb

G:/ai/venvs/3d/Scripts/python.exe studio/runners/to3d.py <картинка.png> <выход.glb> [--faces 8000] [--seed 42]

Код TripoSG — G:/ai/src/TripoSG (официальный, MIT), веса — G:/ai/models/3d/TripoSG.
Извлечение меша — marching cubes из scikit-image (use_flash_decoder=False), поэтому
собирать diso под CUDA не нужно. Рядом с .glb кладётся <имя>-cut.png — что увидела модель.
"""
import argparse
import pathlib
import sys
import types

import numpy as np
import torch
from PIL import Image

TRIPO = pathlib.Path('G:/ai/src/TripoSG')
WEIGHTS = pathlib.Path('G:/ai/models/3d/TripoSG')
BIREFNET = pathlib.Path('G:/ai/models/birefnet')

# diso нужен только «быстрому» декодеру — подменяем пустышкой
sys.modules.setdefault('diso', types.SimpleNamespace(DiffDMC=None))
sys.path[:0] = [str(TRIPO), str(TRIPO / 'scripts')]


def cutout(path: pathlib.Path) -> Image.Image:
    """RGBA с альфой от BiRefNet (MIT)."""
    from transformers import AutoModelForImageSegmentation
    import torchvision.transforms.functional as TF

    net = AutoModelForImageSegmentation.from_pretrained(str(BIREFNET), trust_remote_code=True).cuda().eval().half()
    img = Image.open(path).convert('RGB')
    x = TF.normalize(TF.to_tensor(img.resize((1024, 1024))), [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    with torch.no_grad():
        pred = net(x[None].cuda().half())[-1].sigmoid()[0, 0].float().cpu().numpy()
    del net
    torch.cuda.empty_cache()
    alpha = Image.fromarray((pred * 255).astype(np.uint8)).resize(img.size)
    out = img.copy()
    out.putalpha(alpha)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('image')
    ap.add_argument('out')
    ap.add_argument('--faces', type=int, default=8000, help='упростить до N треугольников (0 — не упрощать)')
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--steps', type=int, default=50)
    ap.add_argument('--depth', type=int, default=8, help='глубина октодерева: 8 — быстро, 9 — детальнее')
    a = ap.parse_args()

    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    cut_path = out.with_name(out.stem + '-cut.png')
    cutout(pathlib.Path(a.image)).save(cut_path)

    from image_process import prepare_image
    from triposg.pipelines.pipeline_triposg import TripoSGPipeline
    # свежая diffusers сама не импортирует модули, названные в model_index.json
    import triposg.schedulers.scheduling_rectified_flow  # noqa: F401
    import triposg.models.transformers.triposg_transformer  # noqa: F401
    import triposg.models.autoencoders.autoencoder_kl_triposg  # noqa: F401

    pipe = TripoSGPipeline.from_pretrained(str(WEIGHTS)).to('cuda', torch.float16)
    img = prepare_image(str(cut_path), bg_color=np.array([1.0, 1.0, 1.0]), rmbg_net=None)
    res = pipe(
        image=img,
        generator=torch.Generator(device='cuda').manual_seed(a.seed),
        num_inference_steps=a.steps,
        guidance_scale=7.0,
        use_flash_decoder=False,
        hierarchical_octree_depth=a.depth,
    ).samples[0]

    import trimesh
    mesh = trimesh.Trimesh(res[0].astype(np.float32), np.ascontiguousarray(res[1]))
    if a.faces and len(mesh.faces) > a.faces:
        import pymeshlab
        ms = pymeshlab.MeshSet()
        ms.add_mesh(pymeshlab.Mesh(vertex_matrix=mesh.vertices, face_matrix=mesh.faces))
        ms.meshing_decimation_quadric_edge_collapse(targetfacenum=a.faces)
        m = ms.current_mesh()
        mesh = trimesh.Trimesh(m.vertex_matrix(), m.face_matrix())
    mesh.export(out)
    print(f'{out}: {len(mesh.vertices)} вершин, {len(mesh.faces)} треугольников')


if __name__ == '__main__':
    main()
