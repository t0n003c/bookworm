for fname in [
    'static/js/home-page-trip-chart.js',
    'static/js/home-page-trip-chart-drill.js',
]:
    txt = open(fname, encoding='utf-8').read()
    b = txt.count('{'); bc = txt.count('}')
    p = txt.count('('); pc = txt.count(')')
    s = txt.count('['); sc = txt.count(']')
    name = fname.split('/')[-1]
    print(name)
    print('  braces  open=%d close=%d diff=%d' % (b, bc, b-bc))
    print('  parens  open=%d close=%d diff=%d' % (p, pc, p-pc))
    print('  squares open=%d close=%d diff=%d' % (s, sc, s-sc))
