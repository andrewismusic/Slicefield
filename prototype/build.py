# Rebuilds slicefield.html from src/ (the same assembly the prototype used).
import pathlib
d=pathlib.Path(__file__).parent/'src'
out=(d/'shell.html').read_text()+'\n<script>\n/*ENGINE START*/\n'+(d/'engine.js').read_text()+'/*ENGINE END*/\n\n/*SYNTH START*/\n'+(d/'synth.js').read_text()+'/*SYNTH END*/\n\n'+(d/'ui.js').read_text()+'\n</script>\n'
(pathlib.Path(__file__).parent/'slicefield.html').write_text(out)
print('wrote slicefield.html',len(out))
