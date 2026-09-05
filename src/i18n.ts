import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type Lang = 'vi' | 'en';
export const LANG_STORAGE_KEY = 'greenwave.lang';

export const vi = {
  'meta.title': 'GreenWave — Lê Duẩn × Lê Lợi · Cầu Sông Hàn',
  'meta.desc':
    'Lab tối ưu đèn giao thông AI: túi OSM quanh Lê Duẩn × Lê Lợi đổ ra Cầu Sông Hàn (20 đèn, lab ùn chiều).',

  'brand.sub': 'Lê Duẩn × Lê Lợi · lab ùn chiều',

  'chip.avgWait': 'chờ TB',
  'chip.p95': 'p95',
  'chip.throughput': 'lưu lượng',
  'chip.live': 'trên đường',
  'chip.moto': 'xe máy',
  'chip.car': 'ô tô',
  'unit.vehH': 'xe/h',

  'nav.tutorial': 'Hướng dẫn',
  'nav.baseline': 'Ghi mốc',
  'nav.lang': 'Ngôn ngữ',

  'mode.title': 'Chế độ điều khiển',
  'mode.fixed': 'Cố định',
  'mode.adaptive': 'Thích ứng',
  'mode.coord': 'Điều phối',
  'mode.optimized': 'Tối ưu',
  'mode.fixed.hint':
    'Kế hoạch naive, không điều phối. Sửa split ở bảng nút đèn. Yếu khi chiều đổ lên cầu.',
  'mode.adaptive.hint':
    'max-pressure nâng cao: hàng local trừ hàng phía dưới (chiết khấu), cộng thêm dòng đến. Có min/max green, vàng, all-red.',
  'mode.coord.hint':
    'max-pressure nâng cao làm mượt trên túi {n} nút: attention theo áp lực nút kề. Vẫn tôn trọng min/max green.',
  'mode.optimized.hint':
    'CMA-ES tìm cycle, split & offset — sóng xanh chạy headless, rồi gắn live như đèn cố định có điều phối.',

  'scen.title': 'Kịch bản nhu cầu',
  'scen.afternoon': 'Chiều',
  'scen.afternoon.sub': 'HC → Sơn Trà',
  'scen.morning': 'Sáng',
  'scen.morning.sub': 'vào Hải Châu',
  'scen.midday': 'Trưa',
  'scen.midday.sub': 'Cân bằng',
  'scen.custom': 'Tùy chỉnh',
  'scen.custom.sub': 'Thanh trượt',
  'scen.volume': 'Lượng xe',
  'scen.ew': 'Lệch E–W',
  'scen.moto': 'Xe máy',
  'scen.random': 'Xáo nhu cầu',
  'scen.seed': 'Seed mới',

  'play.title': 'Phát',
  'play.reset': 'Đặt lại',
  'play.congestion': 'Lớp ùn tắc',
  'play.pause': 'Tạm dừng',
  'play.play': 'Chạy',

  'opt.title': 'Bộ tối ưu',
  'opt.now': 'Tối ưu ngay',
  'opt.junction': 'Tối ưu nút này',
  'opt.junction.hint':
    'Chỉ chỉnh cycle / split / offset của nút đang chọn; 19 nút kia giữ nguyên. Fitness vẫn theo cả mạng.',
  'opt.junction.needSelect': 'Chọn một nút đèn đang sáng trước',
  'opt.junction.baseline': 'CMA-ES mốc (kế hoạch hiện tại)…',
  'opt.junction.applied': 'Đã vá nút · chờ {wait}s · {thr} xe/h',
  'opt.searching': 'Đang tìm…',
  'opt.ready': 'Sẵn sàng tìm split & offset',
  'opt.seeding': 'Khởi tạo CMA-ES…',
  'opt.idle': 'Nghỉ',
  'opt.baseline': 'CMA-ES mốc (naive 50/50)…',
  'opt.sample': 'CMA-ES mẫu {evals}/{total} · gen {gen}/{max}',
  'opt.converged': 'CMA-ES hội tụ · gen {gen}',
  'opt.generation': 'CMA-ES gen {gen}/{max}',
  'opt.done': 'CMA-ES xong · gen {gen}',
  'opt.applied': 'Đã áp kế hoạch · chờ {wait}s · {thr} xe/h',
  'opt.best': 'Kế hoạch tốt nhất · chờ {wait}s · {thr} xe/h · cycle {cycle}s',
  'opt.autoJam': 'Tự tối ưu khi ùn',
  'opt.autoJam.hint':
    'Khi điều kiện ùn (chờ TB / hàng chờ) giữ đủ lâu, chạy tối ưu mạng một lần rồi nghỉ (cooldown). Chỉnh ngưỡng bên dưới.',
  'opt.auto.jam': 'Auto: phát hiện ùn — đang tìm…',
  'opt.auto.last': 'Lần auto: {reason}',
  'opt.auto.cooldown': 'Cooldown còn {s}s sim',
  'opt.auto.idle': 'Auto sẵn sàng',
  'opt.auto.useWait': 'Dùng chờ TB',
  'opt.auto.waitThresh': 'Ngưỡng chờ',
  'opt.auto.useQueue': 'Dùng hàng chờ',
  'opt.auto.queueThresh': 'Ngưỡng hàng',
  'opt.auto.hold': 'Giữ ùn',
  'opt.auto.cooldownLabel': 'Cooldown',
  'opt.auto.triggerWhen': 'Kích hoạt khi',
  'opt.auto.combineOr': 'Một trong hai',
  'opt.auto.combineAnd': 'Cả hai',
  'opt.auto.needOne': 'Cần bật ít nhất chờ TB hoặc hàng chờ.',

  'opt.log.title': 'Nhật ký tối ưu',
  'opt.log.clear': 'Xóa',
  'opt.log.clearConfirm': 'Xóa toàn bộ nhật ký tối ưu?',
  'opt.log.empty': 'Chưa có lần tối ưu nào — chạy Tối ưu nút này hoặc Tối ưu ngay.',
  'opt.log.network': 'Mạng',
  'opt.log.scope': 'Phạm vi',
  'opt.log.scope.junction': 'Nút',
  'opt.log.scope.network': 'Mạng',
  'opt.log.source': 'Nguồn',
  'opt.log.source.manual': 'thủ công',
  'opt.log.source.auto': 'auto',
  'opt.log.simT': 'Sim t',
  'opt.log.scenario': 'Kịch bản',
  'opt.log.seed': 'Seed',
  'opt.log.junction': 'Nút',
  'opt.log.waitShort': 'chờ',
  'opt.log.avgWait': 'Chờ TB',
  'opt.log.p95': 'p95 chờ',
  'opt.log.throughput': 'Lưu lượng',
  'opt.log.stops': 'Dừng / chuyến',
  'opt.log.fitness': 'Fitness',

  'ab.title': 'A / B so với mốc',
  'ab.wait': 'Chờ',
  'ab.throughput': 'Lưu lượng',
  'ab.stops': 'Dừng / chuyến',
  'ab.p95': 'p95 chờ',
  'ab.none': 'so với mốc —',
  'ab.delta': '{sign}{d} so với mốc',
  'ab.hint':
    'Ghi mốc cố định lúc ùn chiều, rồi chuyển Thích ứng hoặc Điều phối, hoặc bấm Tối ưu ngay (CMA-ES). Delta cập nhật live.',

  'zoom.in': 'Phóng to (+)',
  'zoom.fit': 'Vừa mạng (0)',
  'zoom.out': 'Thu nhỏ (−)',
  'zoom.fitLabel': 'Vừa',

  'hud.title': 'HUD live',
  'hud.avgWait': 'Chờ TB',
  'hud.avgWait.sub': 'chuyến đã xong',
  'hud.p95': 'P95 chờ',
  'hud.p95.sub': 'đuôi trễ',
  'hud.throughput': 'Lưu lượng',
  'hud.throughput.sub': 'xe / giờ',
  'hud.queue': 'Tải hàng',
  'hud.queue.sub': 'đơn vị áp lực',
  'hud.speed': 'Tốc độ TB',
  'hud.speed.sub': 'mạng',
  'hud.done': 'Đã xong',
  'hud.done.sub': 'từ lúc đặt lại',

  'chart.title': 'Trễ & dòng',
  'chart.wait': 'chờ',
  'chart.flow': 'dòng',

  'ix.title': 'Nút đèn',
  'ix.arterial': 'trục',
  'ix.local': 'nhánh',
  'ix.yellow': 'vàng',
  'ix.green': 'xanh',
  'ix.allRed': 'all-red',
  'ix.pressure': 'Áp lực N–S {ns} · E–W {ew}',
  'ix.mpAdapt': ' · max-pressure nâng cao',
  'ix.mpCoord': ' · graph-smoothed MP',
  'ix.cycle': 'Cycle',
  'ix.split': 'Split N–S',
  'ix.offset': 'Offset',
  'ix.hint':
    'Split là phần xanh N–S. Offset là lệch đồng hồ chủ — thứ làm nên sóng xanh. Sửa có hiệu lực ngay ở Cố định / Tối ưu.',
  'ix.empty':
    'Bấm một nút đèn đang sáng để xem hàng chờ, chỉnh cycle / split / offset, và theo dõi đếm pha.',
  'ix.durations': 'Thời lượng pha',
  'ix.gNS': 'Xanh N–S',
  'ix.gEW': 'Xanh E–W',
  'ix.yellowSec': 'Vàng',
  'ix.allRedSec': 'All-red',
  'ix.durations.hintFixed':
    'Theo cycle & split hiện tại (Cố định / Tối ưu).',
  'ix.durations.hintLive':
    'Thích ứng / Điều phối: xanh sống trong 8–52s theo hàng chờ; bảng trên là kế hoạch nếu chuyển Cố định.',

  'net.title': 'Mạng',
  'net.blurb':
    '{n} nút đèn OSM · {links} cung có hướng · Lê Duẩn × Lê Lợi · Cầu Sông Hàn · ô tô + xe máy · seed {seed}',
  'net.splitTitle': 'Split N–S trên các nút đèn',

  'foot.tag':
    'GREENWAVE  ·  max-pressure nâng cao  ·  điều phối graph-smoothed  ·  CMA-ES  ·  {n} đèn',
  'foot.tutorial': 'Hướng dẫn',
  'hotkey.play': 'chạy/tạm',
  'hotkey.speed': 'tốc độ',
  'hotkey.zoom': 'phóng',
  'hotkey.fit': 'vừa',
  'hotkey.reset': 'đặt lại',

  'tut.title': 'Hướng dẫn GreenWave',
  'tut.lead': 'Chạy thử 5 phút trên OSM Đà Nẵng — Lê Duẩn × Lê Lợi · Cầu Sông Hàn · 20 đèn.',
  'tut.close': 'Đóng',
  'tut.s1.title': 'Bạn đang nhìn gì',
  'tut.s1.body':
    'Túi OpenStreetMap quanh Lê Duẩn × Lê Lợi đổ ra Cầu Sông Hàn (Han River Bridge) — 20 nút đèn thật, không phải cả thành phố. Đường một chiều theo OSM (Lê Lợi chỉ chiều nam). Nhu cầu chiều dồn đông về cầu. Đường cam-đỏ là hàng chờ (lớp ùn tắc). Chip trên cùng là trễ và dòng của mạng.',
  'tut.s2.title': 'A/B công bằng (làm một lần)',
  'tut.s2.l1':
    'Để <b>Chế độ điều khiển</b> ở <b>Cố định</b> và <b>Nhu cầu</b> ở <b>Chiều</b> (Hải Châu → Sơn Trà lên cầu).',
  'tut.s2.l2':
    'Chỉnh tốc độ <b>4×</b>. Để chạy tới <b>Đã xong</b> bên phải qua ~80. Số chờ chỉ ổn khi chuyến đã về đích.',
  'tut.s2.l3':
    'Bấm <b>Ghi mốc</b> (góc phải trên). Kế hoạch naive 50/50 đóng băng làm mốc so sánh.',
  'tut.s2.l4':
    'Bấm <b>Đặt lại</b>, rồi chuyển <b>Thích ứng</b> (max-pressure nâng cao) hoặc <b>Điều phối</b> (bộ điều khiển attention trên đồ thị). Xem <b>A / B so với mốc</b>. Chờ và dừng nên giảm, lưu lượng nên tăng.',
  'tut.s2.l5':
    'Hoặc Đặt lại, ghi mốc lại, rồi <b>Tối ưu ngay</b> (CMA-ES). Nó tìm cycle, split và offset trên bản sao headless, rồi áp kế hoạch tốt nhất thành <b>Tối ưu</b>.',
  'tut.s2.hint':
    'Đừng đổi chế độ giữa chừng rồi lấy cùng số trung bình. Trễ cũ còn nằm trong đó. Đặt lại, ghi mốc, rồi mới chuyển.',
  'tut.s3.title': 'Bấm một nút',
  'tut.s3.body':
    'Thử Lê Duẩn × Lê Lợi hoặc Cầu Sông Hàn Tây. Cột phải thành bảng kiểm: hàng N/E/S/W live, đếm pha, rồi ba thanh trượt.',
  'tut.s3.cycle': '<b>Cycle</b> — một vòng đỏ-xanh đủ (48–140s).',
  'tut.s3.split': '<b>Split N–S</b> — phần xanh bắc–nam so với đông–tây.',
  'tut.s3.offset': '<b>Offset</b> — lệch đồng hồ chủ. Đây là thứ làm nên sóng xanh.',
  'tut.s3.note':
    'Sửa có hiệu lực ngay ở Cố định và Tối ưu. Thích ứng và Điều phối bỏ qua thanh trượt; chúng tự chọn hướng đang kẹt.',
  'tut.s4.title': 'Bốn chế độ',
  'tut.s4.fixed':
    '<b>Cố định</b> — split đều, không điều phối. Cố tình yếu khi chiều ùn lên cầu. Đó là mốc.',
  'tut.s4.adaptive':
    '<b>Thích ứng</b> — max-pressure nâng cao. Áp lực = nhu cầu hàng local trừ hàng phía dưới (chiết khấu, store-and-forward), cộng thêm dòng đến nhỏ. Xanh về cặp N–S hoặc E–W áp lực cao hơn, có min/max green để không nhấp nháy.',
  'tut.s4.coord':
    '<b>Điều phối</b> — max-pressure nâng cao làm mượt trên đồ thị 20 nút. Mỗi nút trộn áp lực local với attention từ đèn kề. Vẫn tôn trọng min/max green, vàng, và all-red.',
  'tut.s4.opt':
    '<b>Tối ưu ngay</b> — CMA-ES tìm split, offset mỗi nút, và cycle chung. Fitness thưởng lưu lượng, phạt chờ, p95, và dừng. Mẫu tốt nhất thành kế hoạch Tối ưu — sóng xanh cố định có điều phối.',
  'tut.s5.title': 'Phóng bản đồ',
  'tut.s5.body':
    'Cuộn để phóng về con trỏ. Kéo để pan. Nút góc phải dưới bản đồ là <b>+</b> / <b>Vừa</b> / <b>−</b>. Double-click canvas hoặc bấm <kbd>0</kbd> để vừa cả mạng. <kbd>+</kbd> và <kbd>-</kbd> phóng từ tâm.',
  'tut.s6.title': 'Nhu cầu và phím',
  'tut.s6.body':
    '<b>Chiều</b> là đợt 16:00–18:00: Lê Duẩn đông về Cầu Sông Hàn. <b>Sáng</b> là chiều ngược (vào Hải Châu). <b>Trưa</b> cân bằng. Xe máy vẫn chiếm đa số. <b>Tùy chỉnh</b> mở thanh lượng xe, lệch E–W, và % xe máy.',
  'tut.s6.keysClose': 'đóng cái này',
  'tut.s7.title': 'Đọc HUD',
  'tut.s7.body':
    '<b>Chờ TB</b> là trễ chuyến đã xong, không phải tức thời. <b>p95</b> là đuôi khổ. <b>Lưu lượng</b> là xe/h. <b>Tải hàng</b> là áp lực, không phải số xe. Nếu chờ trông tệ hơn sau khi đổi chế độ giữa chừng, đặt lại rồi ghi mốc lại.',
  'tip.mode.fixed':
    'Kế hoạch cố định naive (split ~50/50), không điều phối. Dùng làm mốc A/B khi ùn chiều lên cầu. Sửa cycle/split/offset ở bảng nút.',
  'tip.mode.adaptive':
    'Mỗi nút tự chọn pha N–S / Đ–T theo áp lực hàng chờ (max-pressure nâng cao, trừ 0.6× hàng phía dưới). Không cần Optimize.',
  'tip.mode.coord':
    'Max-pressure nâng cao làm mượt trên đồ thị {n} nút: mỗi đèn trộn áp lực local với attention từ nút kề. Vẫn tôn trọng min/max green.',
  'tip.mode.optimized':
    'Kế hoạch CMA-ES đã tìm: cycle, split & offset cố định có điều phối (sóng xanh). Chạy Optimize trước, rồi chế độ này áp kết quả.',

  'tip.scen.afternoon':
    'Cao điểm 16:00–18:00: Lê Duẩn đông về Cầu Sông Hàn (Hải Châu → Sơn Trà). Kịch bản lab ùn chiều mặc định.',
  'tip.scen.morning':
    'Sáng: dòng ngược vào Hải Châu. Cùng mạng OSM, hướng nhu cầu đảo so với chiều.',
  'tip.scen.midday':
    'Trưa cân bằng E–W / N–S. Ít thiên lệch cầu hơn chiều và sáng.',
  'tip.scen.custom':
    'Mở thanh lượng xe, lệch E–W và % xe máy. Tự chỉnh để stress-test bộ điều khiển.',
  'tip.scen.random':
    'Xáo tỉ lệ spawn trên các cung (giữ kịch bản). Thử độ bền của chế độ đang chạy.',
  'tip.scen.seed':
    'Seed RNG mới rồi đặt lại sim. Cùng seed = cùng dòng xe; seed khác = mẫu nhu cầu khác.',

  'tip.play.toggle':
    'Chạy / tạm dừng mô phỏng (phím Space). Không đổi kế hoạch đèn.',
  'tip.play.speed':
    'Tốc độ sim so với thời gian thật. 4×–8× hữu ích khi chờ chuyến về đích trước khi ghi mốc.',
  'tip.play.reset':
    'Xóa xe, đặt lại đồng hồ và metrics (giữ chế độ, kịch bản, seed). Phím R.',
  'tip.play.congestion':
    'Tô đường theo hàng chờ (cam→đỏ). Không đổi logic sim — chỉ lớp nhìn.',

  'tip.opt.now':
    'CMA-ES cả mạng: ~41 gene (cycle chung + split & offset mỗi đèn trong 20 nút). Chạy headless, rồi áp kế hoạch Tối ưu.',
  'tip.opt.junction':
    'CMA-ES chỉ cycle, split, offset của nút đang chọn (3 gene). Đèn khác giữ nguyên. Fitness vẫn theo chờ/lưu lượng cả mạng.',
  'tip.opt.status':
    'Tiến trình CMA-ES: mẫu / thế hệ, hoặc kết quả đã áp (chờ TB, lưu lượng).',
  'tip.opt.autoJam':
    'Bật để CMA-ES mạng tự chạy khi điều kiện ùn giữ đủ lâu. Ngưỡng, giữ ùn, cooldown và OR/AND chỉnh được bên dưới; lưu localStorage.',
  'tip.opt.auto.useWait':
    'Bật để dùng chờ trung bình (avgWait) làm tín hiệu ùn. Phải giữ ít nhất một trong chờ TB hoặc hàng chờ.',
  'tip.opt.auto.waitThresh':
    'Ngưỡng chờ TB (giây sim). Vượt ngưỡng này được tính là ùn theo metric chờ.',
  'tip.opt.auto.useQueue':
    'Bật để dùng tải hàng chờ (queued) làm tín hiệu ùn. Phải giữ ít nhất một metric.',
  'tip.opt.auto.queueThresh':
    'Ngưỡng tải hàng chờ (áp lực mạng). Vượt ngưỡng = ùn theo metric hàng.',
  'tip.opt.auto.hold':
    'Số giây sim mà điều kiện ùn phải giữ liên tục trước khi kích hoạt CMA-ES (tránh nhiễu ngắn).',
  'tip.opt.auto.cooldown':
    'Số giây sim nghỉ sau khi bắt đầu/xong auto-opt — không kích hoạt lại trong khoảng này.',
  'tip.opt.auto.combine':
    'Một trong hai (OR): đủ một metric đã bật. Cả hai (AND): mọi metric đã bật phải vượt ngưỡng cùng lúc.',
  'tip.opt.logbook':
    'Ghi mỗi lần CMA-ES xong (ưu tiên chi tiết nút: cycle/split/offset trước→sau). Lưu localStorage, tối đa 50 mục.',

  'tip.chip.avgWait':
    'Chờ trung bình của chuyến đã về đích (giây). Chưa ổn định khi còn ít chuyến xong.',
  'tip.chip.p95':
    'Phân vị 95% chờ — đuôi trễ khổ nhất. Nhạy với nút tắc và sóng xanh kém.',
  'tip.chip.throughput':
    'Xe hoàn thành / giờ (ước lượng rolling). Cao hơn thường tốt hơn nếu chờ không tăng.',
  'tip.chip.live':
    'Xe đang trên mạng: xe máy / ô tô. OSM một chiều; xe máy chiếm đa số nhu cầu Đà Nẵng.',

  'tip.hud.avgWait':
    'Chờ TB chuyến đã xong — cùng nghĩa chip trên, hiện lớn ở HUD.',
  'tip.hud.p95':
    'P95 chờ: đuôi trễ. Giảm p95 thường quan trọng hơn giảm TB một chút.',
  'tip.hud.throughput':
    'Lưu lượng xe/h. So với mốc ở khối A/B bên trái.',
  'tip.hud.queue':
    'Tổng áp lực hàng chờ (đơn vị pressure), không phải số xe đếm được.',
  'tip.hud.speed':
    'Tốc độ TB mạng (km/h). Thấp khi ùn hoặc đèn đỏ kéo dài.',
  'tip.hud.done':
    'Số chuyến về đích từ lần Đặt lại. Chờ TB chỉ đáng tin khi con số này đủ lớn (~80+).',

  'tip.ab.section':
    'So live với mốc đã ghi: chờ, lưu lượng, dừng/chuyến, p95. Xanh = tốt hơn mốc; đỏ = tệ hơn.',
  'tip.ab.capture':
    'Đóng băng metrics hiện tại làm mốc A/B. Nên ghi lúc Cố định + Chiều, sau khi đã có đủ chuyến xong.',

  'tip.ix.cycle':
    'Độ dài một vòng đỏ–xanh đủ (48–140s). Dài hơn = ít chuyển pha, có thể tăng hàng chờ nhánh.',
  'tip.ix.split':
    'Phần xanh N–S so với E–W. Sửa có hiệu lực ngay ở Cố định / Tối ưu; Thích ứng & Điều phối tự chọn hướng.',
  'tip.ix.offset':
    'Lệch đồng hồ chủ so với chu kỳ — thứ làm nên sóng xanh giữa các nút liền kề.',
  'tip.ix.durations':
    'Thời lượng pha theo kế hoạch cố định: xanh N–S → vàng → all-red → xanh E–W → vàng → all-red. Công thức giống engine (lost time, split).',

  'tip.zoom.in':
    'Phóng to bản đồ từ tâm (phím +). Cuộn chuột cũng phóng về con trỏ.',
  'tip.zoom.fit':
    'Vừa cả túi OSM 20 đèn vào khung (phím 0 hoặc double-click canvas).',
  'tip.zoom.out':
    'Thu nhỏ bản đồ từ tâm (phím −).',
  'tip.nav.tutorial':
    'Mở hướng dẫn 5 phút: A/B công bằng, bốn chế độ, inspector, phóng bản đồ.',
  'tip.nav.lang':
    'Đổi giao diện Việt / English. Tip và nhãn cập nhật ngay.',

  'tip.net.blurb':
    'Túi OSM Lê Duẩn × Lê Lợi · Cầu Sông Hàn: {n} đèn, đường một chiều theo OSM, ô tô + xe máy.',
  'tip.foot.tag':
    'GreenWave lab: max-pressure nâng cao · điều phối graph-smoothed · CMA-ES · {n} đèn tín hiệu.',
} as const;

export type MsgKey = keyof typeof vi;

export const en: { [K in MsgKey]: string } = {
  'meta.title': 'GreenWave — Lê Duẩn × Lê Lợi · Cầu Sông Hàn',
  'meta.desc':
    'Interactive AI traffic-light timing optimizer: OSM pocket around Lê Duẩn × Lê Lợi feeding Cầu Sông Hàn (20 lights, afternoon jam lab).',

  'brand.sub': 'Lê Duẩn × Lê Lợi · afternoon jam lab',

  'chip.avgWait': 'avg wait',
  'chip.p95': 'p95',
  'chip.throughput': 'throughput',
  'chip.live': 'live',
  'chip.moto': 'moto',
  'chip.car': 'car',
  'unit.vehH': 'veh/h',

  'nav.tutorial': 'Tutorial',
  'nav.baseline': 'Capture baseline',
  'nav.lang': 'Language',

  'mode.title': 'Control mode',
  'mode.fixed': 'Fixed',
  'mode.adaptive': 'Adaptive',
  'mode.coord': 'Coord',
  'mode.optimized': 'Optimized',
  'mode.fixed.hint':
    'Naive coordinated-off plan. Edit splits in the inspector. Poor on the afternoon bridge dump.',
  'mode.adaptive.hint':
    'Advanced max-pressure: local queues minus discounted downstream, plus a small incoming-flow term. Min/max green, yellow, all-red.',
  'mode.coord.hint':
    'Graph-smoothed advanced max-pressure on the {n}-node pocket: attention over neighbor pressures. Still respects min/max green.',
  'mode.optimized.hint':
    'CMA-ES search over cycle, splits & offsets — a green-wave plan evaluated headless, then applied live as coordinated fixed-time.',

  'scen.title': 'Demand scenario',
  'scen.afternoon': 'Afternoon',
  'scen.afternoon.sub': 'HC → Sơn Trà',
  'scen.morning': 'Morning',
  'scen.morning.sub': 'into Hải Châu',
  'scen.midday': 'Midday',
  'scen.midday.sub': 'Balanced',
  'scen.custom': 'Custom',
  'scen.custom.sub': 'Sliders',
  'scen.volume': 'Volume',
  'scen.ew': 'E–W bias',
  'scen.moto': 'Motorbikes',
  'scen.random': 'Randomize demand',
  'scen.seed': 'New seed',

  'play.title': 'Playback',
  'play.reset': 'Reset',
  'play.congestion': 'Congestion overlay',
  'play.pause': 'Pause',
  'play.play': 'Play',

  'opt.title': 'Optimizer',
  'opt.now': 'Optimize now',
  'opt.junction': 'Optimize this junction',
  'opt.junction.hint':
    'Tunes only the selected light’s cycle / split / offset; other lights keep their plan. Fitness stays network-wide.',
  'opt.junction.needSelect': 'Select a glowing signalized junction first',
  'opt.junction.baseline': 'CMA-ES baseline (current plan)…',
  'opt.junction.applied': 'Patched junction · wait {wait}s · {thr} veh/h',
  'opt.searching': 'Searching…',
  'opt.ready': 'Ready to search splits & offsets',
  'opt.seeding': 'Seeding CMA-ES…',
  'opt.idle': 'Idle',
  'opt.baseline': 'CMA-ES baseline (naive 50/50)…',
  'opt.sample': 'CMA-ES sample {evals}/{total} · gen {gen}/{max}',
  'opt.converged': 'CMA-ES converged · gen {gen}',
  'opt.generation': 'CMA-ES generation {gen}/{max}',
  'opt.done': 'CMA-ES done · gen {gen}',
  'opt.applied': 'Applied plan · wait {wait}s · {thr} veh/h',
  'opt.best': 'Best plan · wait {wait}s · {thr} veh/h · cycle {cycle}s',
  'opt.autoJam': 'Auto-optimize on jam',
  'opt.autoJam.hint':
    'When jam conditions (avg wait / queue) hold long enough, run network Optimize once, then cooldown. Tune thresholds below.',
  'opt.auto.jam': 'Auto: jam detected — searching…',
  'opt.auto.last': 'Last auto: {reason}',
  'opt.auto.cooldown': 'Cooldown {s}s sim left',
  'opt.auto.idle': 'Auto ready',
  'opt.auto.useWait': 'Use avg wait',
  'opt.auto.waitThresh': 'Wait thresh',
  'opt.auto.useQueue': 'Use queue load',
  'opt.auto.queueThresh': 'Queue thresh',
  'opt.auto.hold': 'Hold time',
  'opt.auto.cooldownLabel': 'Cooldown',
  'opt.auto.triggerWhen': 'Trigger when',
  'opt.auto.combineOr': 'Either',
  'opt.auto.combineAnd': 'Both',
  'opt.auto.needOne': 'Keep at least avg wait or queue load enabled.',

  'opt.log.title': 'Opt logbook',
  'opt.log.clear': 'Clear',
  'opt.log.clearConfirm': 'Clear the entire optimization logbook?',
  'opt.log.empty': 'No runs yet — use Optimize this junction or Optimize now.',
  'opt.log.network': 'Network',
  'opt.log.scope': 'Scope',
  'opt.log.scope.junction': 'Junction',
  'opt.log.scope.network': 'Network',
  'opt.log.source': 'Source',
  'opt.log.source.manual': 'manual',
  'opt.log.source.auto': 'auto',
  'opt.log.simT': 'Sim t',
  'opt.log.scenario': 'Scenario',
  'opt.log.seed': 'Seed',
  'opt.log.junction': 'Junction',
  'opt.log.waitShort': 'wait',
  'opt.log.avgWait': 'Avg wait',
  'opt.log.p95': 'p95 wait',
  'opt.log.throughput': 'Throughput',
  'opt.log.stops': 'Stops / trip',
  'opt.log.fitness': 'Fitness',

  'ab.title': 'A / B vs baseline',
  'ab.wait': 'Wait',
  'ab.throughput': 'Throughput',
  'ab.stops': 'Stops / trip',
  'ab.p95': 'p95 wait',
  'ab.none': 'vs baseline —',
  'ab.delta': '{sign}{d} vs baseline',
  'ab.hint':
    'Capture an afternoon-jam fixed-time baseline, then switch Adaptive or Coord, or run Optimize now (CMA-ES). Deltas update live.',

  'zoom.in': 'Zoom in (+)',
  'zoom.fit': 'Fit network (0)',
  'zoom.out': 'Zoom out (−)',
  'zoom.fitLabel': 'Fit',

  'hud.title': 'Live HUD',
  'hud.avgWait': 'Avg wait',
  'hud.avgWait.sub': 'completed trips',
  'hud.p95': 'p95 wait',
  'hud.p95.sub': 'tail delay',
  'hud.throughput': 'Throughput',
  'hud.throughput.sub': 'vehicles / hour',
  'hud.queue': 'Queue load',
  'hud.queue.sub': 'pressure units',
  'hud.speed': 'Mean speed',
  'hud.speed.sub': 'network',
  'hud.done': 'Completed',
  'hud.done.sub': 'since reset',

  'chart.title': 'Delay & flow',
  'chart.wait': 'wait',
  'chart.flow': 'flow',

  'ix.title': 'Intersection',
  'ix.arterial': 'arterial',
  'ix.local': 'local',
  'ix.yellow': 'yellow',
  'ix.green': 'green',
  'ix.allRed': 'all-red',
  'ix.pressure': 'Pressure N–S {ns} · E–W {ew}',
  'ix.mpAdapt': ' · advanced max-pressure',
  'ix.mpCoord': ' · graph-smoothed MP',
  'ix.cycle': 'Cycle',
  'ix.split': 'Split N–S',
  'ix.offset': 'Offset',
  'ix.hint':
    'Split is the N–S share of effective green. Offset is the master-clock shift used for green waves. Edits apply immediately in Fixed / Optimized modes.',
  'ix.empty':
    'Click a glowing signalized junction to inspect queues, retune cycle / split / offset, and watch the phase countdown.',
  'ix.durations': 'Phase durations',
  'ix.gNS': 'Green N–S',
  'ix.gEW': 'Green E–W',
  'ix.yellowSec': 'Yellow',
  'ix.allRedSec': 'All-red',
  'ix.durations.hintFixed':
    'From current cycle & split (Fixed / Optimized).',
  'ix.durations.hintLive':
    'Adaptive / Coord: live green is 8–52s from queues; table above is the plan if you switch to Fixed.',

  'net.title': 'Network',
  'net.blurb':
    '{n} OSM signalized junctions · {links} directed links · Lê Duẩn × Lê Lợi · Cầu Sông Hàn · mixed cars + motorbikes · seed {seed}',
  'net.splitTitle': 'N–S split across signalized junctions',

  'foot.tag':
    'GREENWAVE  ·  advanced max-pressure  ·  graph-smoothed coord  ·  CMA-ES  ·  {n} đèn',
  'foot.tutorial': 'How to use',
  'hotkey.play': 'play/pause',
  'hotkey.speed': 'speed',
  'hotkey.zoom': 'zoom',
  'hotkey.fit': 'fit',
  'hotkey.reset': 'reset',

  'tut.title': 'How to use GreenWave',
  'tut.lead': 'A 5-minute first run on OSM Đà Nẵng — Lê Duẩn × Lê Lợi · Cầu Sông Hàn · 20 đèn.',
  'tut.close': 'Close',
  'tut.s1.title': 'What you are looking at',
  'tut.s1.body':
    'OpenStreetMap pocket around Lê Duẩn × Lê Lợi feeding Cầu Sông Hàn (Han River Bridge) — 20 real signalized junctions, not the whole city. One-way streets follow OSM (Lê Lợi is southbound only). Afternoon demand stacks eastbound onto the bridge. Orange-red roads are queues (congestion overlay). The top chips are network delay and flow.',
  'tut.s2.title': 'Fair A/B (do this once)',
  'tut.s2.l1':
    'Leave <b>Control mode</b> on <b>Fixed</b> and <b>Demand</b> on <b>Afternoon</b> (Hải Châu → Sơn Trà onto the bridge).',
  'tut.s2.l2':
    'Set speed to <b>4×</b>. Let it run until <b>Completed</b> on the right is past ~80. Wait numbers only settle after trips finish.',
  'tut.s2.l3':
    'Hit <b>Capture baseline</b> (top right). That freezes the naive 50/50 plan as your comparison.',
  'tut.s2.l4':
    'Hit <b>Reset</b>, then switch to <b>Adaptive</b> (advanced max-pressure) or <b>Coord</b> (the live graph-attention controller). Watch <b>A / B vs baseline</b>. Wait and stops should drop, throughput should rise.',
  'tut.s2.l5':
    'Or Reset, recapture, then <b>Optimize now</b> (CMA-ES). It searches cycle, splits and offsets in a headless copy of this sim, then applies the best plan as <b>Optimized</b>.',
  'tut.s2.hint':
    'Do not switch modes mid-run and judge the same averages. They keep the old delay in them. Reset, recapture, then switch.',
  'tut.s3.title': 'Click a junction',
  'tut.s3.body':
    'Try Lê Duẩn × Lê Lợi or Cầu Sông Hàn Tây. The right rail becomes an inspector: live N/E/S/W queues, phase countdown, then three sliders.',
  'tut.s3.cycle': '<b>Cycle</b> — length of one full red-green loop (48–140s).',
  'tut.s3.split': '<b>Split N–S</b> — share of green for north–south vs east–west.',
  'tut.s3.offset': '<b>Offset</b> — master-clock shift. This is what makes a green wave.',
  'tut.s3.note':
    'Edits apply immediately in Fixed and Optimized. Adaptive and Coord ignore the sliders; they pick the jammed approach on their own.',
  'tut.s4.title': 'The four modes',
  'tut.s4.fixed':
    '<b>Fixed</b> — naive equal split, no coordination. Meant to suck in the afternoon bridge jam. That is the baseline.',
  'tut.s4.adaptive':
    '<b>Adaptive</b> — advanced max-pressure. Pressure is local queued demand minus a discounted downstream queue (store-and-forward), plus a small incoming-flow term. Green goes to the N–S or E–W pair with higher pressure, with min/max green so it does not flicker.',
  'tut.s4.coord':
    '<b>Coord</b> — graph-smoothed advanced max-pressure on this 20-node graph. Each junction blends local pressure with attention over adjacent lights. Still respects min/max green, yellow, and all-red.',
  'tut.s4.opt':
    '<b>Optimize now</b> — CMA-ES search over every junction’s split, offset, and a shared cycle. Fitness rewards throughput and punishes wait, p95, and stops. Best sample becomes the Optimized plan, a coordinated fixed-time green wave.',
  'tut.s5.title': 'Zoom the map',
  'tut.s5.body':
    'Scroll to zoom toward the cursor. Drag to pan. Buttons at the bottom-right of the map are <b>+</b> / <b>Fit</b> / <b>−</b>. Double-click the canvas or press <kbd>0</kbd> to fit the whole network. <kbd>+</kbd> and <kbd>-</kbd> zoom from the center.',
  'tut.s6.title': 'Demand and keys',
  'tut.s6.body':
    '<b>Afternoon</b> is the 16:00–18:00 dump: heavy eastbound Lê Duẩn onto Cầu Sông Hàn. <b>Morning</b> is the opposite (into Hải Châu). <b>Midday</b> is balanced. Motorbikes stay the majority. <b>Custom</b> unlocks volume, E–W bias, and motorbike % sliders.',
  'tut.s6.keysClose': 'close this',
  'tut.s7.title': 'How to read the HUD',
  'tut.s7.body':
    '<b>Avg wait</b> is completed-trip delay, not instantaneous. <b>p95</b> is the miserable tail. <b>Throughput</b> is veh/h. <b>Queue load</b> is pressure, not a vehicle count. If wait looks worse after a mid-run mode switch, reset and recapture.',
  'tip.mode.fixed':
    'Naive fixed-time (~50/50 splits), no coordination. Use as the A/B baseline for the afternoon bridge jam. Edit cycle/split/offset in the inspector.',
  'tip.mode.adaptive':
    'Each light picks N–S vs E–W from queue pressure (advanced max-pressure, minus 0.6× downstream queue). No Optimize needed.',
  'tip.mode.coord':
    'Graph-smoothed advanced max-pressure on this {n}-node pocket: each light blends local pressure with neighbor attention. Still respects min/max green.',
  'tip.mode.optimized':
    'Applied CMA-ES plan: coordinated fixed cycle, splits & offsets (green wave). Run Optimize first; this mode holds the result.',

  'tip.scen.afternoon':
    '16:00–18:00 dump: heavy eastbound Lê Duẩn onto Cầu Sông Hàn (Hải Châu → Sơn Trà). Default jam lab.',
  'tip.scen.morning':
    'Morning reverse flow into Hải Châu. Same OSM network, opposite demand bias.',
  'tip.scen.midday':
    'Balanced E–W / N–S midday demand. Less bridge-skewed than afternoon or morning.',
  'tip.scen.custom':
    'Unlocks volume, E–W bias, and motorbike % sliders for stress-testing controllers.',
  'tip.scen.random':
    'Jitter spawn rates across links (keeps scenario). Probe how robust the current mode is.',
  'tip.scen.seed':
    'New RNG seed and reset. Same seed = same trips; new seed = a different demand sample.',

  'tip.play.toggle':
    'Play / pause the sim (Space). Does not change signal plans.',
  'tip.play.speed':
    'Sim speed vs wall clock. 4×–8× helps reach enough completed trips before capturing a baseline.',
  'tip.play.reset':
    'Clear vehicles, clock, and metrics (keeps mode, scenario, seed). Hotkey R.',
  'tip.play.congestion':
    'Color roads by queue pressure (orange→red). Visual only — sim logic unchanged.',

  'tip.opt.now':
    'Network-wide CMA-ES: ~41 genes (shared cycle + split & offset for each of 20 lights). Runs headless, then applies Optimized.',
  'tip.opt.junction':
    'CMA-ES over this light’s cycle, split, and offset only. Other lights keep their plan. Fitness is still network-wide wait/throughput.',
  'tip.opt.status':
    'CMA-ES progress: samples / generations, or the applied result (avg wait, throughput).',
  'tip.opt.autoJam':
    'When on, network CMA-ES auto-runs once jam conditions hold long enough. Thresholds, hold, cooldown, and OR/AND are editable below; saved to localStorage.',
  'tip.opt.auto.useWait':
    'Include avg wait (avgWait) as a jam signal. At least one of avg wait or queue load must stay on.',
  'tip.opt.auto.waitThresh':
    'Avg-wait threshold in sim-seconds. Crossing it counts as wait-jam.',
  'tip.opt.auto.useQueue':
    'Include queue load (queued) as a jam signal. Keep at least one metric enabled.',
  'tip.opt.auto.queueThresh':
    'Queue-load threshold (network pressure). Crossing it counts as queue-jam.',
  'tip.opt.auto.hold':
    'Sim-seconds the jam condition must persist before firing CMA-ES (filters brief spikes).',
  'tip.opt.auto.cooldown':
    'Sim-seconds to wait after auto-opt starts/finishes before another trigger.',
  'tip.opt.auto.combine':
    'Either (OR): any enabled metric over threshold. Both (AND): every enabled metric must be over threshold together.',
  'tip.opt.logbook':
    'Logs each finished CMA-ES run (junction entries are detailed: cycle/split/offset before→after). Stored in localStorage, capped at 50.',

  'tip.chip.avgWait':
    'Mean wait of completed trips (seconds). Unstable until enough trips finish.',
  'tip.chip.p95':
    '95th-percentile wait — the miserable tail. Sensitive to jammed nodes and weak green waves.',
  'tip.chip.throughput':
    'Completed vehicles / hour (rolling). Higher is usually better if wait does not rise.',
  'tip.chip.live':
    'Vehicles on the network: moto / car. OSM one-ways; motorbikes dominate Đà Nẵng demand.',

  'tip.hud.avgWait':
    'Completed-trip avg wait — same meaning as the top chip, shown large in the HUD.',
  'tip.hud.p95':
    'p95 wait: delay tail. Cutting p95 often matters more than shaving a little off the mean.',
  'tip.hud.throughput':
    'Throughput in veh/h. Compare against baseline in the left A/B card.',
  'tip.hud.queue':
    'Total queue pressure (pressure units), not a raw vehicle count.',
  'tip.hud.speed':
    'Network mean speed (km/h). Drops under congestion or long reds.',
  'tip.hud.done':
    'Trips finished since Reset. Avg wait is trustworthy only after this is large enough (~80+).',

  'tip.ab.section':
    'Live vs captured baseline: wait, throughput, stops/trip, p95. Green = better than baseline; red = worse.',
  'tip.ab.capture':
    'Freeze current metrics as the A/B baseline. Prefer Fixed + Afternoon after enough completed trips.',

  'tip.ix.cycle':
    'Full red–green loop length (48–140s). Longer = fewer phase changes; side streets may queue more.',
  'tip.ix.split':
    'N–S share of effective green vs E–W. Edits apply immediately in Fixed / Optimized; Adaptive & Coord pick approaches themselves.',
  'tip.ix.offset':
    'Master-clock shift within the cycle — what builds a green wave across adjacent lights.',
  'tip.ix.durations':
    'Fixed-plan phase lengths: green N–S → yellow → all-red → green E–W → yellow → all-red. Same engine formulas (lost time, split).',

  'tip.zoom.in':
    'Zoom in from map center (+ key). Scroll also zooms toward the cursor.',
  'tip.zoom.fit':
    'Fit the whole 20-light OSM pocket (0 key or double-click canvas).',
  'tip.zoom.out':
    'Zoom out from map center (− key).',
  'tip.nav.tutorial':
    'Open the 5-minute guide: fair A/B, four modes, inspector, map zoom.',
  'tip.nav.lang':
    'Switch UI Vietnamese / English. Labels and tips update live.',

  'tip.net.blurb':
    'OSM pocket Lê Duẩn × Lê Lợi · Cầu Sông Hàn: {n} lights, OSM one-ways, mixed cars + motorbikes.',
  'tip.foot.tag':
    'GreenWave lab: advanced max-pressure · graph-smoothed coord · CMA-ES · {n} signalized lights.',
};

export function loadLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    if (v === 'en' || v === 'vi') return v;
  } catch {
    /* ignore */
  }
  return 'vi';
}

export function saveLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
}

function interpolate(template: string, params?: Record<string, string | number>) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    params[k] !== undefined && params[k] !== null ? String(params[k]) : `{${k}}`,
  );
}

export function t(lang: Lang, key: MsgKey, params?: Record<string, string | number>): string {
  const dict = lang === 'en' ? en : vi;
  return interpolate(dict[key], params);
}

export type OptMsg = { key: MsgKey; params?: Record<string, string | number> };

type I18nValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MsgKey, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

function applyDocumentLang(lang: Lang) {
  document.documentElement.lang = lang;
  document.title = t(lang, 'meta.title');
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', t(lang, 'meta.desc'));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(loadLang);

  useEffect(() => {
    applyDocumentLang(lang);
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    saveLang(next);
    setLangState(next);
    applyDocumentLang(next);
  }, []);

  const tr = useCallback(
    (key: MsgKey, params?: Record<string, string | number>) => t(lang, key, params),
    [lang],
  );

  return createElement(I18nContext.Provider, { value: { lang, setLang, t: tr } }, children);
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
