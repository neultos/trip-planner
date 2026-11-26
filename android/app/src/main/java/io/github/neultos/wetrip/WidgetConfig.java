package io.github.neultos.wetrip;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.*;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** 위젯을 놓을 때 어떤 여행을 보여 줄지 고르는 창 */
public final class WidgetConfig extends Activity {
    private int wid = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        Bundle ex = getIntent().getExtras();
        if (ex != null) wid = ex.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, wid);
        if (wid == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }

        List<TripStore.Trip> trips = TripStore.all(this);
        List<String> labels = new ArrayList<>(), ids = new ArrayList<>();
        labels.add("자동: 여행 중이거나 가장 가까운 여행");
        ids.add(TripStore.AUTO);
        LocalDate today = LocalDate.now();
        for (TripStore.Trip t : trips) { labels.add(t.title + "\n" + TripStore.dates(t) + " · " + TripStore.badge(t, today)); ids.add(t.id); }

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setBackgroundColor(Color.WHITE);
        int p = (int) (20 * getResources().getDisplayMetrics().density);
        box.setPadding(p, p, p, p / 2);
        TextView h = new TextView(this);
        h.setText("위젯에 보여 줄 여행");
        h.setTextSize(19);
        h.setTextColor(Color.rgb(17, 24, 39));
        h.setTypeface(null, android.graphics.Typeface.BOLD);
        box.addView(h);
        if (trips.isEmpty()) {
            TextView n = new TextView(this);
            n.setText("아직 불러온 여행이 없어요. 위트립 앱을 한 번 열면 목록이 생겨요. 자동으로 두면 그때부터 보여 줘요.");
            n.setTextColor(Color.rgb(107, 114, 128));
            n.setPadding(0, p / 2, 0, 0);
            box.addView(n);
        }
        ListView list = new ListView(this);
        list.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, labels));
        list.setOnItemClickListener((a, view, i, id) -> {
            TripStore.prefs(this).edit().putString("w" + wid, ids.get(i)).apply();
            TripWidget.draw(this, AppWidgetManager.getInstance(this), wid);
            setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, wid));
            finish();
        });
        box.addView(list, new LinearLayout.LayoutParams(-1, 0, 1));
        box.setGravity(Gravity.TOP);
        setContentView(box);
    }
}
