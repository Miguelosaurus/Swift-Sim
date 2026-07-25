import SwiftUI
// importSlot01
// importSlot02
// importSlot03
// importSlot04
// importSlot05
// importSlot06
// importSlot07
// importSlot08
// importSlot09
// importSlot10
// macroSlot01
// macroSlot02
// macroSlot03
// macroSlot04
// macroSlot05
// macroSlot06
// macroSlot07
// macroSlot08
// macroSlot09
// macroSlot10
struct CatalogScreen: View {
    let title: String = "Catalog"
    let storedSlot01: String = "stored-01"
    let storedSlot02: String = "stored-02"
    let storedSlot03: String = "stored-03"
    let storedSlot04: String = "stored-04"
    let storedSlot05: String = "stored-05"
    let storedSlot06: String = "stored-06"
    let storedSlot07: String = "stored-07"
    let storedSlot08: String = "stored-08"
    let storedSlot09: String = "stored-09"
    let storedSlot10: String = "stored-10"
    let storedSlot11: String = "stored-11"
    let storedSlot12: String = "stored-12"
    let storedSlot13: String = "stored-13"
    let storedSlot14: String = "stored-14"
    let storedSlot15: String = "stored-15"
    let storedSlot16: String = "stored-16"
    let storedSlot17: String = "stored-17"
    let storedSlot18: String = "stored-18"
    let storedSlot19: String = "stored-19"
    let storedSlot20: String = "stored-20"
    var body: some View {
        VStack {
            BenchmarkMarkerView(value: "copy-01")
            BenchmarkMarkerView(value: "copy-02")
            BenchmarkMarkerView(value: "copy-03")
            BenchmarkMarkerView(value: "copy-04")
            BenchmarkMarkerView(value: "copy-05")
            BenchmarkMarkerView(value: "copy-06")
            BenchmarkMarkerView(value: "copy-07")
            BenchmarkMarkerView(value: "copy-08")
            BenchmarkMarkerView(value: "copy-09")
            BenchmarkMarkerView(value: "copy-10")
            BenchmarkMarkerView(value: "style-01").foregroundStyle(.blue)
            BenchmarkMarkerView(value: "style-02").foregroundStyle(.blue)
            BenchmarkMarkerView(value: "style-03").foregroundStyle(.blue)
            BenchmarkMarkerView(value: "style-04").foregroundStyle(.blue)
            BenchmarkMarkerView(value: "style-05").foregroundStyle(.blue)
            BenchmarkMarkerView(value: "style-06").foregroundStyle(.blue)
            BenchmarkMarkerView(value: "style-07").foregroundStyle(.blue)
            BenchmarkMarkerView(value: "style-08").foregroundStyle(.blue)
            BenchmarkMarkerView(value: "style-09").foregroundStyle(.blue)
            BenchmarkMarkerView(value: "style-10").foregroundStyle(.blue)
            BenchmarkMarkerView(value: "layout-01").padding(8)
            BenchmarkMarkerView(value: "layout-02").padding(8)
            BenchmarkMarkerView(value: "layout-03").padding(8)
            BenchmarkMarkerView(value: "layout-04").padding(8)
            BenchmarkMarkerView(value: "layout-05").padding(8)
            BenchmarkMarkerView(value: "layout-06").padding(8)
            BenchmarkMarkerView(value: "layout-07").padding(8)
            BenchmarkMarkerView(value: "layout-08").padding(8)
            BenchmarkMarkerView(value: "layout-09").padding(8)
            BenchmarkMarkerView(value: "layout-10").padding(8)
            if true { BenchmarkMarkerView(value: "composition-01") }
            if true { BenchmarkMarkerView(value: "composition-02") }
            if true { BenchmarkMarkerView(value: "composition-03") }
            if true { BenchmarkMarkerView(value: "composition-04") }
            if true { BenchmarkMarkerView(value: "composition-05") }
            if true { BenchmarkMarkerView(value: "composition-06") }
            if true { BenchmarkMarkerView(value: "composition-07") }
            if true { BenchmarkMarkerView(value: "composition-08") }
            if true { BenchmarkMarkerView(value: "composition-09") }
            if true { BenchmarkMarkerView(value: "composition-10") }
            BenchmarkMarkerView(value: "animation-01").animation(.easeInOut(duration: 0.2), value: title)
            BenchmarkMarkerView(value: "animation-02").animation(.easeInOut(duration: 0.2), value: title)
            BenchmarkMarkerView(value: "animation-03").animation(.easeInOut(duration: 0.2), value: title)
            BenchmarkMarkerView(value: "animation-04").animation(.easeInOut(duration: 0.2), value: title)
            BenchmarkMarkerView(value: "animation-05").animation(.easeInOut(duration: 0.2), value: title)
            BenchmarkMarkerView(value: "animation-06").animation(.easeInOut(duration: 0.2), value: title)
            BenchmarkMarkerView(value: "animation-07").animation(.easeInOut(duration: 0.2), value: title)
            BenchmarkMarkerView(value: "animation-08").animation(.easeInOut(duration: 0.2), value: title)
            BenchmarkMarkerView(value: "animation-09").animation(.easeInOut(duration: 0.2), value: title)
            BenchmarkMarkerView(value: "animation-10").animation(.easeInOut(duration: 0.2), value: title)
            Text("macro-01")
            Text("macro-02")
            Text("macro-03")
            Text("macro-04")
            Text("macro-05")
            Text("macro-06")
            Text("macro-07")
            Text("macro-08")
            Text("macro-09")
            Text("macro-10")
            Text("import-01")
            Text("import-02")
            Text("import-03")
            Text("import-04")
            Text("import-05")
            Text("import-06")
            Text("import-07")
            Text("import-08")
            Text("import-09")
            Text("import-10")
        }
    }
}
