import shutil
import os

for dirpath, dirnames, filenames in os.walk('./assets/level-1'):
    for dirname in dirnames:
        from_filename = os.path.join(dirpath, dirname, 'image.png')
        os.rename(from_filename, os.path.join(dirpath, dirname + '.png'))
        shutil.rmtree(os.path.join(dirpath, dirname))
