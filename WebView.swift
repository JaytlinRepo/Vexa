import SwiftUI
import WebKit

// MARK: - WebView Wrapper
struct WebView: UIViewRepresentable {
    let url: URL
    
    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.load(URLRequest(url: url))
        return webView
    }
    
    func updateUIView(_ webView: WKWebView, context: Context) {
        // Update if needed
    }
}

// MARK: - Content View
struct ContentView: View {
    var body: some View {
        VStack {
            if let url = URL(string: "http://localhost:3000") {
                WebView(url: url)
                    .edgesIgnoringSafeArea(.all)
            } else {
                Text("Invalid URL")
                    .foregroundColor(.red)
            }
        }
    }
}

// MARK: - Preview
#Preview {
    ContentView()
}
