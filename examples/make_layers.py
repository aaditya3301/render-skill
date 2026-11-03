"""Create original, schematic test layers; no third-party artwork is needed."""
from pathlib import Path
from PIL import Image, ImageDraw


def make_layers(destination: Path) -> dict[str, Path]:
    destination = Path(destination)
    directories = {kind: destination / kind for kind in ('phone', 'burger')}
    for folder in directories.values():
        folder.mkdir(parents=True, exist_ok=False)
    phone = [('cover-glass', '#c0daf0'), ('display', '#486df0'), ('frame', '#94a0b0'),
             ('board', '#216d4e'), ('battery', '#30313a'), ('back', '#171b25')]
    for i, (name, color) in enumerate(phone, 1):
        image = Image.new('RGBA', (600, 800))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((160, 75, 440, 725), radius=45, fill=color, outline='#e0e4ee', width=3)
        if name == 'cover-glass':
            image.putalpha(image.getchannel('A').point(lambda a: int(a * .22)))
        elif name == 'frame':
            draw.rounded_rectangle((178, 95, 422, 705), radius=32, fill=(0, 0, 0, 0))
        elif name == 'board':
            for y in range(140, 650, 100):
                draw.rectangle((210, y, 270, y + 50), fill='#173329', outline='#d9b35a', width=3)
        image.save(directories['phone'] / f'{i:02d}-{name}.png')
    food = [('top-bun', (140, 95, 460, 205), '#df9b40'), ('sauce', (145, 190, 455, 225), '#e6b84b'),
            ('tomato', (135, 225, 465, 275), '#e44d36'), ('lettuce', (125, 270, 475, 315), '#69a941'),
            ('patty', (135, 310, 465, 375), '#64412c'), ('bottom-bun', (140, 370, 460, 430), '#d59442')]
    for i, (name, box, color) in enumerate(food, 1):
        image = Image.new('RGBA', (600, 600))
        draw = ImageDraw.Draw(image)
        if name == 'top-bun':
            draw.pieslice((140, 95, 460, 315), 180, 360, fill=color)
            for x, y in [(200, 160), (260, 130), (320, 150), (370, 175), (295, 180)]:
                draw.ellipse((x, y, x + 10, y + 4), fill='#fff1ca')
        elif name == 'lettuce':
            points = [(125, 285), (155, 270), (190, 287), (225, 271), (265, 287), (305, 270),
                      (345, 286), (385, 272), (430, 287), (475, 280), (455, 315), (140, 313)]
            draw.polygon(points, fill=color)
        else:
            draw.rounded_rectangle(box, radius=18, fill=color)
            draw.arc(box, 0, 180, fill='#4b2f20', width=3)
        image.save(directories['burger'] / f'{i:02d}-{name}.png')
    return directories


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    for kind, folder in make_layers(args.output).items():
        print(f'{kind}: {folder.resolve()}')
