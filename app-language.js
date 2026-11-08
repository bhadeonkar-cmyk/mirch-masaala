/* Mirch Masaala app-wide language layer.
 * Runs locally, preserves the English source text, and translates dynamic UI,
 * notifications, accessible labels and order errors without external services.
 */
(function () {
  'use strict';

  var dictionary = {
    'Dine in made easy — scan your table QR.':'टेबलचा QR स्कॅन करा आणि सहज ऑर्डर द्या.',
    'Welcome!':'स्वागत आहे!',
    'No table selection or code needed. Scan your table QR and your table is selected automatically.':'टेबल निवडण्याची किंवा कोड टाकण्याची गरज नाही. टेबलचा QR स्कॅन करा; टेबल आपोआप निवडले जाईल.',
    'Start with your table QR':'टेबल QR ने सुरुवात करा',
    'Scan → choose dishes → track order':'स्कॅन करा → पदार्थ निवडा → ऑर्डर पाहा',
    'QR help':'QR मदत',
    'Choose your table':'आपले टेबल निवडा',
    'Swipe sideways to find your table':'टेबल शोधण्यासाठी बाजूला स्वाइप करा',
    'Continue to table →':'टेबलकडे पुढे जा →',
    'Scan table QR':'टेबलचा QR स्कॅन करा',
    'Open your table menu and start ordering':'टेबलचा मेनू उघडा आणि ऑर्डर सुरू करा',
    'Find your dishes':'तुमचे पदार्थ शोधा',
    'Search first, then use food filters if needed':'आधी पदार्थ शोधा; गरज असेल तर खाद्य प्रकार निवडा',
    '🎉 Congratulations! Your order is confirmed':'🎉 अभिनंदन! तुमची ऑर्डर निश्चित झाली आहे',
    'Your ticket is on its way to the kitchen.':'तुमची ऑर्डर थेट किचनकडे जात आहे.',
    'Sent straight to kitchen':'थेट किचनमध्ये पाठवली',
    'No waiter or kitchen approval needed.':'वेटर किंवा किचनची मंजुरी आवश्यक नाही.',
    'One table, separate tickets':'एक टेबल, स्वतंत्र ऑर्डर्स',
    'Friends can order separately; this visit shares one bill.':'मित्र स्वतंत्र ऑर्डर देऊ शकतात; या टेबल भेटीचे एकच बिल असेल.',
    'Bill after serving':'जेवण वाढल्यानंतर बिल',
    'Once all dishes are served and payment is recorded, the table becomes free.':'सर्व पदार्थ वाढून पेमेंट नोंदवल्यावर टेबल मोकळे होईल.',
    'Your order is confirmed and sent directly to the kitchen. No approval is needed.':'तुमची ऑर्डर निश्चित झाली आहे आणि थेट किचनला पाठवली आहे. वेगळी मंजुरी आवश्यक नाही.',
    'Order sent directly to kitchen!':'ऑर्डर थेट किचनला पाठवली!',
    'Request cash payment':'रोख पेमेंटची विनंती करा',
    'Requesting cash payment…':'रोख पेमेंटची विनंती पाठवत आहे…',
    'Cash payment requested':'रोख पेमेंटची विनंती पाठवली',
    'Cash payment requested. Counter staff are notified; the table stays active until payment is recorded.':'रोख पेमेंटची विनंती पाठवली आहे. काउंटरला कळवले आहे; पेमेंट नोंद होईपर्यंत टेबल सुरू राहील.',
    'Waiting for the owner/counter to record payment. Your table stays active until the full bill is settled.':'मालक/काउंटरकडून पेमेंट नोंदवण्याची प्रतीक्षा करा. पूर्ण बिल भरल्यावरच टेबल मोकळे होईल.',
    'The counter has been notified about the cash payment. The table stays active until the full bill is recorded as paid.':'रोख पेमेंटसाठी काउंटरला कळवले आहे. पूर्ण बिल भरल्याची नोंद होईपर्यंत टेबल सुरू राहील.',
    'No unpaid balance remains for this visit.':'या टेबल भेटीची कोणतीही बाकी रक्कम नाही.',
    'Cash checkout is not activated yet. Please tell the waiter you will pay at the counter.':'रोख काउंटर पेमेंट अजून सुरू केलेले नाही. वेटरला काउंटरवर पैसे देणार असल्याचे सांगा.',
    'This phone is not linked to your active table visit. Please ask the waiter to help with cash checkout.':'हा फोन तुमच्या सुरू असलेल्या टेबल भेटीशी जोडलेला नाही. रोख पेमेंटसाठी वेटरची मदत घ्या.',
    'Table payment is pending':'टेबलचे पेमेंट प्रलंबित आहे',
    'This table stays active until the Owner/Counter records full payment.':'मालक/काउंटरकडून पूर्ण पेमेंट नोंदवल्यावरच टेबल मोकळे होईल.',

    'Sticker missing? Ask your waiter for the correct table link.':'स्टिकर नसेल तर वेटरकडून योग्य टेबल लिंक घ्या.',
    'How to use':'वापरण्याची माहिती',
    'Places to visit':'भेट देण्याची ठिकाणे',
    'Visit us':'आम्हाला भेट द्या',
    'Reviews':'अभिप्राय',
    'Staff access':'कर्मचारी प्रवेश',
    'Authorised team only. Ask the owner for your login details.':'फक्त अधिकृत कर्मचारी. लॉगिन तपशीलांसाठी मालकांना विचारा.',
    'Install staff app':'कर्मचारी अ‍ॅप इन्स्टॉल करा',
    'Add one icon to your home screen for quick, full-screen access.':'जलद, पूर्ण-स्क्रीन वापरासाठी होम स्क्रीनवर आयकॉन जोडा.',
    'Waiter Pad':'वेटर पॅड',
    'Staff login required':'कर्मचारी लॉगिन आवश्यक',
    'Kitchen':'किचन',
    'Owner / Admin':'मालक / प्रशासक',
    'Authorised staff only':'फक्त अधिकृत कर्मचारी',
    'Hide':'लपवा',
    'How to order:':'ऑर्डर कशी द्यावी:',
    'Choose dishes, tap ADD, then open your cart to place the order.':'पदार्थ निवडा, जोडा बटण दाबा आणि ऑर्डर देण्यासाठी कार्ट उघडा.',
    'Help & orders':'मदत व ऑर्डर्स',
    '← Change table':'← टेबल बदला',
    '← Back to menu':'← मेनूकडे परत',
    'Your order':'तुमची ऑर्डर',
    'Any special request?':'काही खास सूचना?',
    'Place order':'ऑर्डर द्या',
    '← Change items':'← पदार्थ बदला',
    'Add to cart':'कार्टमध्ये जोडा',
    'Not now':'आत्ता नको',
    '← Tables':'← टेबल्स',
    'Waiter':'वेटर',
    'Tap a table to start. Highlighted tables already have orders.':'सुरू करण्यासाठी टेबल निवडा. हायलाइट केलेल्या टेबलवर ऑर्डर आहेत.',
    'TAKING ORDER FOR':'या टेबलसाठी ऑर्डर',
    'Table':'टेबल',
    'Change table':'टेबल बदला',
    'Ticket':'ऑर्डर',
    'Send to kitchen':'किचनला पाठवा',
    'Sign out':'साइन आउट',
    'Check order before sending':'पाठवण्यापूर्वी ऑर्डर तपासा',
    'Please check the table, food and guest note.':'टेबल, पदार्थ आणि ग्राहकाची सूचना तपासा.',
    'Confirm & send to kitchen':'खात्री करून किचनला पाठवा',
    'Back to edit':'बदलण्यासाठी परत',
    'Open now':'आत्ता सुरू आहे',
    'Closed now':'सध्या बंद आहे',
    'Language / भाषा':'भाषा / Language',
    'Home':'मुख्यपृष्ठ',
    '← Home':'← मुख्यपृष्ठ',
    'Menu':'मेनू',
    'View cart':'कार्ट पाहा',
    'View menu':'मेनू पाहा',
    'Cart':'कार्ट',
    'Your cart':'तुमची कार्ट',
    'Cart is empty':'कार्ट रिकामी आहे',
    'Your order is empty':'तुमची ऑर्डर रिकामी आहे',
    'Add dishes to get started.':'सुरुवात करण्यासाठी पदार्थ जोडा.',
    'Continue shopping':'पदार्थ निवडणे सुरू ठेवा',
    'Subtotal':'एकूण उपरक्कम',
    'Total':'एकूण',
    'Qty':'प्रमाण',
    'Quantity':'प्रमाण',
    'Remove':'काढून टाका',
    'Remove item':'पदार्थ काढून टाका',
    'ADD':'जोडा',
    'Added':'पदार्थ जोडला',
    'Add':'जोडा',
    'Search dishes…':'पदार्थ शोधा…',
    'Search menu':'मेनू शोधा',
    'Search dishes':'पदार्थ शोधा',
    'Search':'शोधा',
    'Filter by food type':'अन्नप्रकार निवडा',
    'All foods':'सर्व पदार्थ',
    'All':'सर्व',
    'All items':'सर्व पदार्थ',
    'Veg only':'फक्त शाकाहारी',
    'Non-veg only':'फक्त मांसाहारी',
    'Vegetarian':'शाकाहारी',
    'Non-vegetarian':'मांसाहारी',
    'Veg':'शाकाहारी',
    'Non-veg':'मांसाहारी',
    'Specials':'विशेष पदार्थ',
    'Chef special':'शेफची खास निवड',
    'Chef special recommendation':'शेफची खास शिफारस',
    'Vegetarian chef pick':'शेफची शाकाहारी खास निवड',
    'No items':'पदार्थ उपलब्ध नाहीत',
    'No dishes found':'पदार्थ सापडले नाहीत',
    'Try another search or category.':'दुसरा शब्द किंवा विभाग शोधून पाहा.',
    'Guest note…':'ग्राहकाची नोंद…',
    'Guest note':'ग्राहकाची नोंद',
    'Any special request?':'काही खास सूचना?',
    'Food preference':'खाद्यपदार्थांची पसंती',
    'Spice level':'तिखटपणा',
    'Normal':'मध्यम',
    'Mild':'कमी तिखट',
    'Medium':'मध्यम तिखट',
    'Spicy':'तिखट',
    'Extra spicy':'अतितिखट',
    'Choose options':'पर्याय निवडा',
    'Select quantity':'प्रमाण निवडा',
    'Order received!':'ऑर्डर मिळाली!',
    'Order placed successfully!':'ऑर्डर यशस्वीरीत्या नोंदवली!',
    'Order sent directly to kitchen!':'ऑर्डर थेट किचनला पाठवली!',
    'Your order has been sent directly to the kitchen. 🍳':'तुमची ऑर्डर थेट किचनला पाठवली आहे. 🍳',
    'Track your order':'तुमची ऑर्डर पाहा',
    'Order status':'ऑर्डरची स्थिती',
    'Order progress':'ऑर्डरची प्रगती',
    'My orders':'माझ्या ऑर्डर्स',
    'No orders yet':'अजून ऑर्डर नाहीत',
    'No order yet for this table. Add the guest’s dishes below.':'या टेबलसाठी अजून ऑर्डर नाही. खाली पदार्थ निवडा.',
    'Order details':'ऑर्डरचा तपशील',
    'Order number':'ऑर्डर क्रमांक',
    'Ticket number':'ऑर्डर क्रमांक',
    'Table number':'टेबल क्रमांक',
    'Placed at':'ऑर्डरची वेळ',
    'Order time':'ऑर्डरची वेळ',
    'Refresh status':'स्थिती अद्ययावत करा',
    'Refresh':'रिफ्रेश करा',
    'Cancel order':'ऑर्डर रद्द करा',
    'Cancel this order?':'ही ऑर्डर रद्द करायची आहे का?',
    'Order cancellation':'ऑर्डर रद्द करणे',
    'This order can no longer be cancelled. Please ask your waiter.':'ही ऑर्डर आता रद्द करता येणार नाही. कृपया वेटरला विचारा.',
    'Order cancelled':'ऑर्डर रद्द केली',
    'Order received':'ऑर्डर मिळाली',
    'NEW':'नवीन',
    'PREPARING':'बनत आहे',
    'COOKING':'बनत आहे',
    'READY':'तयार',
    'SERVED':'वाढले',
    'CANCELLED':'रद्द',
    'PAID':'पैसे भरले',
    'APPROVED':'मंजूर',
    'PENDING':'प्रलंबित',
    'REJECTED':'नाकारले',
    'NEW ORDER':'नवीन ऑर्डर',
    'ORDER READY':'ऑर्डर तयार',
    'WAITER CALLED':'वेटरला बोलावले',
    'BILL REQUEST':'बिलाची विनंती',
    'SOLD OUT':'संपला',
    'Food served ✓':'जेवण दिले ✓',
    'recent tickets':'अलीकडील ऑर्डर्स',
    'active':'सुरू',
    'No active tickets':'सध्या ऑर्डर नाहीत',
    'No active orders':'सध्या ऑर्डर नाहीत',
    'No orders in the kitchen right now.':'सध्या किचनमध्ये ऑर्डर नाहीत.',
    'New order received':'नवीन ऑर्डर आली आहे',
    'New customer order received':'ग्राहकाची नवीन ऑर्डर आली आहे',
    'New order received in the kitchen':'किचनमध्ये नवीन ऑर्डर आली आहे',
    'Order ready to serve':'ऑर्डर वाढण्यासाठी तयार आहे',
    'Guest needs a waiter':'ग्राहकाला वेटरची मदत हवी आहे',
    'Guest requested the bill':'ग्राहकाने बिल मागितले आहे',
    'A new kitchen ticket has arrived':'किचनमध्ये नवीन ऑर्डर आली आहे',
    'A menu item is unavailable.':'हा पदार्थ सध्या उपलब्ध नाही.',
    'Please go to the guest now.':'कृपया लगेच ग्राहकाकडे जा.',
    'A guest needs help with the bill.':'ग्राहकाला बिलासाठी मदत हवी आहे.',
    'Please check the ready ticket.':'तयार ऑर्डर तपासा.',
    'Done':'झाले',
    'I AM GOING · MARK HANDLED':'मी येत आहे · पूर्ण करा',
    'Mark handled':'पूर्ण झाले असे नोंदवा',
    'Alert options':'सूचना पर्याय',
    'Notifications':'सूचना',
    'Enable notifications':'सूचना सुरू करा',
    'Enable push alerts':'पुश सूचना सुरू करा',
    'Push alerts enabled. This phone can alert the waiter when a guest calls, even if the app is in the background.':'पुश सूचना सुरू झाल्या. अ‍ॅप पार्श्वभूमीत असतानाही ग्राहकाने वेटरला बोलावल्यास या फोनवर सूचना मिळेल.',
    'Allow notifications for Mirch Masaala to alert this phone when guests call.':'ग्राहकाने वेटरला बोलावल्यावर या फोनवर सूचना मिळण्यासाठी Mirch Masaala च्या सूचना परवानगी द्या.',
    'Notifications are blocked for this app. Enable them in phone Settings, then try again.':'या अ‍ॅपच्या सूचना बंद आहेत. फोनच्या सेटिंग्जमध्ये सूचना सुरू करून पुन्हा प्रयत्न करा.',
    'The one-time staff push SQL setup has not been applied yet.':'कर्मचारी पुश सूचनांसाठी आवश्यक SQL अद्याप लागू केलेले नाही.',
    'Could not enable push alerts. Ask the owner to finish the one-time Supabase push setup.':'पुश सूचना सुरू करता आल्या नाहीत. मालकांना Supabase पुश सेटअप पूर्ण करण्यास सांगा.',
    'Staff connection is not ready. Reopen the staff app and try again.':'कर्मचारी कनेक्शन तयार नाही. कर्मचारी अ‍ॅप पुन्हा उघडून प्रयत्न करा.',
    'Your staff session expired. Sign in again, then enable alerts.':'तुमचे कर्मचारी सत्र संपले आहे. पुन्हा लॉगिन करून सूचना सुरू करा.',
    'Waiter called':'वेटरला बोलावले',
    'Call waiter':'वेटरला बोलवा',
    'Need help?':'मदत हवी आहे?',
    'Ask for help':'मदत मागा',
    'Request bill':'बिल मागवा',
    'Bill':'बिल',
    'View bill':'बिल पाहा',
    'Pay bill':'बिल भरा',
    'Payment':'पेमेंट',
    'Payment method':'पेमेंटची पद्धत',
    'Cash':'रोख',
    'Cash at counter':'काउंटरवर रोख रक्कम',
    'Pay at counter':'काउंटरवर पैसे भरा',
    'UPI':'UPI',
    'Pay by UPI':'UPI ने पैसे भरा',
    'UPI payment':'UPI पेमेंट',
    'Please confirm at the counter.':'कृपया काउंटरवर पेमेंटची खात्री करून घ्या.',
    'Please confirm payment at the counter.':'कृपया काउंटरवर पेमेंटची खात्री करून घ्या.',
    'The counter team will confirm and record your payment.':'काउंटरवरील कर्मचारी तुमचे पेमेंट तपासून नोंदवतील.',
    'I have paid':'मी पैसे भरले आहेत',
    'I paid by UPI':'मी UPI ने पैसे भरले',
    'Ask staff to verify payment':'पेमेंट तपासण्यासाठी कर्मचाऱ्यांना सांगा',
    'Request payment verification':'पेमेंट तपासण्याची विनंती करा',
    'Payment verification requested':'पेमेंट तपासण्याची विनंती पाठवली',
    'Payment received':'पेमेंट मिळाले',
    'Payment pending':'पेमेंट प्रलंबित',
    'Outstanding balance':'बाकी रक्कम',
    'Amount due':'देय रक्कम',
    'Amount paid':'भरलेली रक्कम',
    'Total due':'एकूण देय',
    'Paid in full':'पूर्ण पैसे भरले',
    'Payment recorded':'पेमेंट नोंदवले',
    'Only the Owner/Counter using the Admin login can confirm and record payment.':'फक्त Admin लॉगिन वापरणारा मालक/काउंटर कर्मचारी पेमेंटची खात्री करून नोंद करू शकतो.',
    'DIRECT GUEST TO COUNTER · ACKNOWLEDGE':'ग्राहकाला काउंटरकडे पाठवा · नोंद करा',
    'The guest says they paid. Verify the transaction before recording payment.':'ग्राहकाने पैसे भरल्याचे सांगितले आहे. पेमेंट नोंदवण्यापूर्वी व्यवहार तपासा.',
    'Please ask the waiter to start this table.':'कृपया वेटरला हे टेबल सुरू करण्यास सांगा.',
    'This table is not open for ordering yet. Please ask your waiter to start the visit.':'या टेबलसाठी ऑर्डर देणे अद्याप सुरू झालेले नाही. कृपया वेटरला टेबल सुरू करण्यास सांगा.',
    'This phone is not linked to an active table visit. Please ask staff for the bill.':'हा फोन सध्या सुरू असलेल्या टेबल भेटीशी जोडलेला नाही. बिलासाठी कर्मचाऱ्यांना सांगा.',
    'This phone is not linked to the current table visit':'हा फोन सध्याच्या टेबल भेटीशी जोडलेला नाही.',
    'Guest left · free table':'ग्राहक निघून गेला · टेबल मोकळे करा',
    'Guest left before checkout':'ग्राहक बिल भरण्यापूर्वी निघून गेला',
    'Guests have left before checkout. Please collect the outstanding balance from the original visit.':'ग्राहक बिल भरण्यापूर्वी निघून गेले. मूळ भेटीची बाकी रक्कम वसूल करा.',
    'Select a table':'टेबल निवडा',
    'Choose table':'टेबल निवडा',
    'Table is available':'टेबल उपलब्ध आहे',
    'Available':'उपलब्ध',
    'Busy':'व्यस्त',
    'In service':'सेवेत',
    'Open visit':'सुरू असलेली भेट',
    'Start visit':'टेबल सुरू करा',
    'Finish visit':'टेबलची सेवा पूर्ण करा',
    'Release table':'टेबल मोकळे करा',
    'Start table service':'टेबल सेवा सुरू करा',
    'Table service':'टेबल सेवा',
    'Table is busy':'टेबल व्यस्त आहे',
    'Table status':'टेबलची स्थिती',
    'The table visit has changed.':'टेबल भेटीची स्थिती बदलली आहे.',
    'Could not send the order. Please ask your waiter.':'ऑर्डर पाठवता आली नाही. कृपया वेटरला सांगा.',
    'Could not send the waiter order.':'वेटरची ऑर्डर पाठवता आली नाही.',
    'Could not send the order. Please try again.':'ऑर्डर पाठवता आली नाही. कृपया पुन्हा प्रयत्न करा.',
    'The restaurant menu could not load. Check your connection and refresh.':'रेस्टॉरंटचा मेनू लोड झाला नाही. इंटरनेट तपासून पेज पुन्हा उघडा.',
    'Loading the latest restaurant menu. Please wait a moment and try again.':'अद्ययावत मेनू लोड होत आहे. कृपया थोडा वेळ थांबून पुन्हा प्रयत्न करा.',
    'The latest menu is still loading. Please wait and try again.':'अद्ययावत मेनू अजून लोड होत आहे. कृपया थांबून पुन्हा प्रयत्न करा.',
    'Sending order…':'ऑर्डर पाठवत आहे…',
    'Loading…':'लोड होत आहे…',
    'Please wait…':'कृपया थांबा…',
    'Try again':'पुन्हा प्रयत्न करा',
    'Save':'जतन करा',
    'Saved':'जतन झाले',
    'Cancel':'रद्द करा',
    'Close':'बंद करा',
    'Back':'मागे',
    'Next':'पुढे',
    'Continue':'पुढे जा',
    'Confirm':'खात्री करा',
    'Confirm & send to kitchen':'खात्री करून किचनला पाठवा',
    'Edit':'बदला',
    'Update':'अद्ययावत करा',
    'Delete':'हटवा',
    'Yes':'होय',
    'No':'नाही',
    'No thanks':'नको, धन्यवाद',
    'Settings':'सेटिंग्ज',
    'Owner':'मालक',
    'Owner / Admin':'मालक / प्रशासक',
    'Dashboard':'डॅशबोर्ड',
    'Orders':'ऑर्डर्स',
    'Kitchen queue':'किचन ऑर्डर्स',
    'Active orders':'सुरू असलेल्या ऑर्डर्स',
    'Order history':'ऑर्डर इतिहास',
    'Accounts':'हिशेब',
    'Payments':'पेमेंट्स',
    'Reports':'अहवाल',
    'Sales':'विक्री',
    'Today':'आज',
    'Yesterday':'काल',
    'Date':'दिनांक',
    'From':'पासून',
    'To':'पर्यंत',
    'Filter':'फिल्टर',
    'Status':'स्थिती',
    'Actions':'कृती',
    'Details':'तपशील',
    'Price':'किंमत',
    'Item':'पदार्थ',
    'Items':'पदार्थ',
    'Order total':'ऑर्डरची एकूण रक्कम',
    'Table capacity':'टेबलची क्षमता',
    'Manage menu':'मेनू व्यवस्थापित करा',
    'Menu items':'मेनूतील पदार्थ',
    'Availability':'उपलब्धता',
    'Available for ordering':'ऑर्डरसाठी उपलब्ध',
    'Mark sold out':'संपले असे चिन्हांकित करा',
    'Mark available':'उपलब्ध करा',
    'SOLD OUT':'संपला',
    'Waiter names':'वेटरची नावे',
    'Waiter directory':'वेटर यादी',
    'Add waiter':'वेटर जोडा',
    'Add staff member':'कर्मचारी जोडा',
    'Name':'नाव',
    'Staff name':'कर्मचाऱ्याचे नाव',
    'Staff ID':'कर्मचारी आयडी',
    'Choose your name':'आपले नाव निवडा',
    'Choose waiter':'वेटर निवडा',
    'Select waiter':'वेटर निवडा',
    'Install staff app':'कर्मचारी अ‍ॅप इन्स्टॉल करा',
    'Enable alerts':'सूचना सुरू करा',
    'Owner settings':'मालक सेटिंग्ज',
    'App settings':'अ‍ॅप सेटिंग्ज',
    'Reset app':'अ‍ॅप रीसेट करा',
    'Reset settings':'सेटिंग्ज रीसेट करा',
    'Download data backup':'डेटाचा बॅकअप डाउनलोड करा',
    'Create backup':'बॅकअप तयार करा',
    'Backups are due every 10 days.':'दर १० दिवसांनी बॅकअप घ्यावा.',
    'Backup recommended':'बॅकअप घेण्याची शिफारस',
    'Last backup':'शेवटचा बॅकअप',
    'No backup recorded':'बॅकअप नोंदवलेला नाही',
    'Backup completed':'बॅकअप पूर्ण झाला',
    'Reset cancelled':'रीसेट रद्द केला',
    'Reset complete':'रीसेट पूर्ण झाला',
    'Before resetting, download a backup or explicitly continue without one.':'रीसेट करण्यापूर्वी बॅकअप डाउनलोड करा किंवा बॅकअपशिवाय पुढे जाण्याची स्पष्ट पुष्टी द्या.',
    'Type RESET MIRCH MASAALA to confirm.':'पुष्टी करण्यासाठी RESET MIRCH MASAALA टाइप करा.',
    'QR help':'QR मदत',
    'Table QR':'टेबल QR',
    'Open / print QR sheet':'QR शीट उघडा / प्रिंट करा',
    'Generate & print all table QRs':'सर्व टेबल QR तयार करा आणि प्रिंट करा',
    'Print':'प्रिंट करा',
    'Share':'शेअर करा',
    'Copy link':'लिंक कॉपी करा',
    'Copy':'कॉपी करा',
    'Copied':'कॉपी झाले',
    'Download':'डाउनलोड करा',
    'Upload':'अपलोड करा',
    'Party booking':'कार्यक्रम बुकिंग',
    'Party booking request':'कार्यक्रम बुकिंगची विनंती',
    'New party booking request':'नवीन कार्यक्रम बुकिंगची विनंती',
    'Book a celebration':'समारंभासाठी बुकिंग करा',
    'Event type':'कार्यक्रमाचा प्रकार',
    'Event date':'कार्यक्रमाची तारीख',
    'Event time':'कार्यक्रमाची वेळ',
    'Number of guests':'पाहुण्यांची संख्या',
    'Guest count':'पाहुण्यांची संख्या',
    'Mobile number':'मोबाईल क्रमांक',
    '10-digit mobile number':'१० अंकी मोबाईल क्रमांक',
    'Special requests':'विशेष सूचना',
    'Submit request':'विनंती पाठवा',
    'Request sent':'विनंती पाठवली',
    'Thank you':'धन्यवाद',
    'Reviews and feedback':'अभिप्राय',
    'Send feedback':'अभिप्राय पाठवा',
    'Feedback':'अभिप्राय',
    'Required':'आवश्यक',
    'Please enter a valid mobile number.':'कृपया योग्य मोबाईल क्रमांक टाका.',
    'A new party booking request needs your attention.':'नवीन कार्यक्रम बुकिंगची विनंती आली आहे.',
    'NEW ORDER · TABLE':'नवीन ऑर्डर · टेबल',
    'NEW ORDER · OWNER APPROVAL REQUIRED · TABLE':'नवीन ऑर्डर · मालकांची मंजुरी आवश्यक · टेबल',
    'CASH AT COUNTER · TABLE':'काउंटरवर रोख पैसे · टेबल',
    'GUEST LEFT · BALANCE DUE · TABLE':'ग्राहक न भरता निघून गेला · बाकी रक्कम · टेबल',
    'PAYMENT VERIFICATION · TABLE':'पेमेंट तपासा · टेबल',
    'NEW PARTY BOOKING REQUEST':'नवीन कार्यक्रम बुकिंगची विनंती',
    'WAITER NEEDED · TABLE':'वेटर हवा · टेबल',
    'BILL REQUEST · TABLE':'बिलाची विनंती · टेबल',
    'ORDER READY · TABLE':'ऑर्डर तयार · टेबल',
    'MENU AVAILABILITY UPDATE':'मेनू उपलब्धतेतील बदल',
    'The shared database is not connected.':'सामायिक डेटाबेस जोडलेला नाही.',
    'The shared database is not connected yet. Please refresh and try again.':'सामायिक डेटाबेस अद्याप जोडलेला नाही. पेज रिफ्रेश करून पुन्हा प्रयत्न करा.',
    'Secure table ordering is not activated yet. Please ask the owner to finish the table setup.':'सुरक्षित टेबल ऑर्डरिंग अद्याप सुरू केलेले नाही. कृपया मालकांना टेबल सेटअप पूर्ण करण्यास सांगा.',
    'Online table ordering is not connected. Please ask staff for help.':'ऑनलाइन टेबल ऑर्डरिंग जोडलेले नाही. कृपया कर्मचाऱ्यांची मदत घ्या.',
    'Table-order protection is not activated yet. Please ask the owner to finish the table visit setup.':'टेबल ऑर्डरिंगची सुरक्षा अद्याप सुरू केलेली नाही. कृपया मालकांना टेबल भेटीचा सेटअप पूर्ण करण्यास सांगा.',
    'The menu has changed. Refresh and try again.':'मेनूमध्ये बदल झाला आहे. पेज रिफ्रेश करून पुन्हा प्रयत्न करा.',
    'A menu item is no longer available. Please remove it and try again.':'एक पदार्थ आता उपलब्ध नाही. तो काढून पुन्हा प्रयत्न करा.',
    'The network connection failed. Please check your internet and try again.':'इंटरनेट कनेक्शनमध्ये अडचण आली. इंटरनेट तपासून पुन्हा प्रयत्न करा.',
    'An unexpected error occurred. Please ask your waiter for help.':'अनपेक्षित अडचण आली. कृपया वेटरची मदत घ्या.',
    'Order setup needs an update. Please tell the owner to apply the required QR-order SQL migration, then try again.':'ऑनलाइन ऑर्डर सेटअप अद्ययावत करणे आवश्यक आहे. मालकांना आवश्यक QR-order SQL migration लागू करण्यास सांगा आणि पुन्हा प्रयत्न करा.',
    'This table has not been started by a waiter yet. Please ask your waiter to start the table, then try again.':'वेटरने हे टेबल अद्याप सुरू केलेले नाही. कृपया वेटरला टेबल सुरू करण्यास सांगून पुन्हा प्रयत्न करा.',
    'The menu changed while you were ordering. Please refresh the menu before trying again.':'तुम्ही ऑर्डर देत असताना मेनूमध्ये बदल झाला. पुन्हा प्रयत्न करण्यापूर्वी मेनू रिफ्रेश करा.',
    'The order could not be confirmed. Please check My orders before retrying.':'ऑर्डरची खात्री होऊ शकली नाही. पुन्हा प्रयत्न करण्यापूर्वी माझ्या ऑर्डर्स तपासा.',
    'This phone is not linked to an active table visit. Please ask staff for the bill.':'हा फोन सध्या सुरू असलेल्या टेबल भेटीशी जोडलेला नाही. बिलासाठी कर्मचाऱ्यांना सांगा.',
    'A restaurant update needs your attention.':'रेस्टॉरंटमधील नवीन सूचनेकडे लक्ष द्या.',
    'ORDER AWAITING OWNER APPROVAL':'मालकांची मंजुरी आवश्यक असलेली ऑर्डर',
    'GUEST LEFT · BALANCE DUE':'ग्राहक निघून गेला · बाकी रक्कम',
    'CASH AT COUNTER':'काउंटरवर रोख पैसे',
    'PAYMENT VERIFICATION':'पेमेंट तपासा',
    'PARTY BOOKING REQUEST':'कार्यक्रम बुकिंगची विनंती',
    'ORDER APPROVAL':'ऑर्डर मंजुरी',
    'TABLE · GO NOW':'टेबल · लगेच जा',
    'Booking':'बुकिंग',
    'Ticket #':'ऑर्डर क्रमांक ',
    'DIRECT GUEST TO COUNTER · ACKNOWLEDGE':'ग्राहकाला काउंटरकडे पाठवा · नोंद करा',
    'COUNTER ALERTED · ACKNOWLEDGE':'काउंटरला कळवले · नोंद करा',
    'ASK OWNER/COUNTER TO VERIFY · ACKNOWLEDGE':'मालक/काउंटरकडून पेमेंट तपासून घ्या · नोंद करा',
    'COLLECT OUTSTANDING BALANCE':'बाकी रक्कम वसूल करा',
    'COLLECT CASH':'रोख रक्कम घ्या',
    'VERIFY & RECORD PAYMENT':'पेमेंट तपासा व नोंदवा',
    'REVIEW ORDER · APPROVE OR REJECT':'ऑर्डर तपासा · मंजूर करा किंवा नकार द्या',
    'OPEN PAYMENT LOG':'पेमेंट नोंद उघडा',
    'ACKNOWLEDGE AFTER CHECKING':'तपासून नोंद करा',
    'VIEW PARTY BOOKINGS':'कार्यक्रम बुकिंग पाहा',
    'Please check the table balance':'कृपया टेबलची बाकी रक्कम तपासा',
    'ITEM SOLD OUT':'पदार्थ संपला',
    'New approved order received':'नवीन मंजूर ऑर्डर आली आहे',
    'Owner approved order · ready for preparation':'मालकांनी ऑर्डर मंजूर केली · तयार करण्यास सज्ज',
    'Customer order waiting for owner approval':'ग्राहकाची ऑर्डर मालकांच्या मंजुरीसाठी प्रतीक्षेत आहे',
    'Order sent to kitchen':'ऑर्डर किचनला पाठवली',
    'Your order is now in the kitchen queue.':'तुमची ऑर्डर किचनमध्ये आहे.',
    'Order cancelled':'ऑर्डर रद्द केली',
    'This order was cancelled. Please ask your waiter for help.':'ही ऑर्डर रद्द झाली आहे. मदतीसाठी वेटरला सांगा.',
    'Your order is ready':'तुमची ऑर्डर तयार आहे',
    'Your food is ready. Please check with the restaurant team.':'तुमचे जेवण तयार आहे. कृपया रेस्टॉरंटच्या कर्मचाऱ्यांशी संपर्क साधा.',
    'Your order is being prepared':'तुमची ऑर्डर तयार केली जात आहे',
    'The kitchen has started preparing your order.':'किचनमध्ये तुमची ऑर्डर बनवायला सुरुवात झाली आहे.',
    'A guest is leaving and will pay at the counter.':'ग्राहक काउंटरवर पैसे देणार आहे.',
    'Guests have left before settlement. Please collect the outstanding balance.':'ग्राहक बिल भरण्यापूर्वी निघून गेले. कृपया बाकी रक्कम वसूल करा.',
    'Please attend the table bill request.':'कृपया टेबलवरील बिलाची विनंती हाताळा.',
    'A new kitchen ticket has arrived.':'किचनमध्ये नवीन ऑर्डर आली आहे.',
    'Please check the ready ticket.':'तयार ऑर्डर तपासा.',
    'Kitchen changed menu availability.':'किचनने पदार्थाची उपलब्धता बदलली आहे.'
  };

  function clean(value) {
    return String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function key(value) {
    return clean(value).toLocaleLowerCase();
  }
  var forward = Object.create(null);
  var reverse = Object.create(null);
  Object.keys(dictionary).forEach(function (en) {
    forward[key(en)] = dictionary[en];
    if (!reverse[key(dictionary[en])]) reverse[key(dictionary[en])] = en;
  });

  // Also reverse-map the original home/waiter dictionary, which may already
  // have replaced its labels before this file loads.
  function addTranslationPairs(enMap, mrMap) {
    if (!enMap || !mrMap || typeof enMap !== 'object' || typeof mrMap !== 'object') return;
    Object.keys(enMap).forEach(function (id) {
      var en = enMap[id];
      var mr = mrMap[id];
      if (typeof en !== 'string' || typeof mr !== 'string' || !clean(en) || !clean(mr)) return;
      if (!forward[key(en)]) forward[key(en)] = mr;
      if (!reverse[key(mr)]) reverse[key(mr)] = en;
    });
  }
  function addBasicPairs(map) {
    if (!map || typeof map !== 'object') return;
    Object.keys(map).forEach(function (en) {
      var mr = map[en];
      if (typeof mr !== 'string' || !clean(mr)) return;
      if (!forward[key(en)]) forward[key(en)] = mr;
      if (!reverse[key(mr)]) reverse[key(mr)] = en;
    });
  }
  addTranslationPairs(
    window.MM_TRANSLATIONS && window.MM_TRANSLATIONS.en,
    window.MM_TRANSLATIONS && window.MM_TRANSLATIONS.mr
  );
  addBasicPairs(window.MM_MR_BASIC);

  var textState = new WeakMap();
  var attributeState = new WeakMap();
  var attributeNames = ['placeholder', 'title', 'aria-label', 'alt'];
  // Skip executable/code/graphic content, but still translate input placeholders and labels.
  var skipContentTags = { SCRIPT: true, STYLE: true, NOSCRIPT: true, CODE: true, PRE: true, SVG: true };
  var noTranslateTextTags = { INPUT: true, TEXTAREA: true };

  function translatedSourceText(source) {
    var normalized = clean(source);
    var direct = forward[key(normalized)];
    if (direct) return direct;
    var match = normalized.match(/^table\s+([0-9]{1,3})$/i);
    if (match) return 'टेबल ' + match[1];
    match = normalized.match(/^ticket\s+([a-z0-9-]+)\s*[·-]\s*table\s+([0-9]{1,3})$/i);
    if (match) return 'ऑर्डर ' + match[1] + ' · टेबल ' + match[2];
    match = normalized.match(/^ticket\s+([a-z0-9-]+)$/i);
    if (match) return 'ऑर्डर ' + match[1];
    match = normalized.match(/^(\d+)\s+items?$/i);
    if (match) return match[1] + ' पदार्थ';
    match = normalized.match(/^(\d+)\s+orders?$/i);
    if (match) return match[1] + ' ऑर्डर्स';
    match = normalized.match(/^(\d+)\s+guests?$/i);
    if (match) return match[1] + ' पाहुणे';
    match = normalized.match(/^table\s+([0-9]{1,3})\s+(is\s+)?(available|busy|in service)$/i);
    if (match) return 'टेबल ' + match[1] + (match[3].toLowerCase() === 'available' ? ' उपलब्ध आहे' : match[3].toLowerCase() === 'busy' ? ' व्यस्त आहे' : ' सेवेत आहे');
    match = normalized.match(/^cash at counter\s*[·-]\s*table\s+([0-9]{1,3})$/i);
    if (match) return 'काउंटरवर रोख पैसे · टेबल ' + match[1];
    match = normalized.match(/^guest left\s*[·-]\s*balance due\s*[·-]\s*table\s+([0-9]{1,3})$/i);
    if (match) return 'ग्राहक बिल न भरता निघून गेला · बाकी रक्कम · टेबल ' + match[1];
    match = normalized.match(/^payment verification\s*[·-]\s*table\s+([0-9]{1,3})$/i);
    if (match) return 'पेमेंट तपासा · टेबल ' + match[1];
    match = normalized.match(/^waiter needed\s*[·-]\s*table\s+([0-9]{1,3})$/i);
    if (match) return 'वेटर हवा · टेबल ' + match[1];
    match = normalized.match(/^bill request\s*[·-]\s*table\s+([0-9]{1,3})$/i);
    if (match) return 'बिलाची विनंती · टेबल ' + match[1];
    match = normalized.match(/^new order\s*[·-]\s*owner approval required\s*[·-]\s*table\s+([0-9]{1,3})$/i);
    if (match) return 'नवीन ऑर्डर · मालकांची मंजुरी आवश्यक · टेबल ' + match[1];
    match = normalized.match(/^item sold out$/i);
    if (match) return 'पदार्थ संपला';
    match = normalized.match(/^new order\s*[·-]\s*table\s+([0-9]{1,3})$/i);
    if (match) return 'नवीन ऑर्डर · टेबल ' + match[1];
    match = normalized.match(/^order ready\s*[·-]\s*table\s+([0-9]{1,3})$/i);
    if (match) return 'ऑर्डर तयार · टेबल ' + match[1];
    match = normalized.match(/^table\s+([0-9]{1,3})\s*·\s*(.*)$/i);
    if (match) {
      var inner = translatedSourceText(match[2]);
      if (inner) return 'टेबल ' + match[1] + ' · ' + inner;
    }
    match = normalized.match(/^table\s+([0-9]{1,3})\s*·\s*ticket\s+([a-z0-9-]+)\s*·\s*(.*)$/i);
    if (match) {
      var ticketMessage = translatedSourceText(match[3]);
      if (ticketMessage) return 'टेबल ' + match[1] + ' · ऑर्डर ' + match[2] + ' · ' + ticketMessage;
    }
    return null;
  }

  function translate(source) {
    var original = String(source == null ? '' : source);
    if (window.MM_HOME_LANGUAGE !== 'mr') return original;
    var leading = (original.match(/^\s*/) || [''])[0];
    var trailing = (original.match(/\s*$/) || [''])[0];
    var normalized = clean(original);
    if (!normalized) return original;
    var result = translatedSourceText(normalized);
    if (!result) return original;
    return leading + result + trailing;
  }

  function sourceForTextNode(node) {
    var current = node.nodeValue;
    var state = textState.get(node);
    if (state && current === state.last) return state.source;
    var recovered = reverse[key(current)];
    return recovered || current;
  }

  function translateTextNode(node) {
    if (!node || !node.parentElement) return;
    var el = node.parentElement;
    if (skipContentTags[el.tagName] || noTranslateTextTags[el.tagName] || el.isContentEditable || el.closest('[contenteditable="true"],[data-no-translate]')) return;
    var current = node.nodeValue;
    var source = sourceForTextNode(node);
    var result = translate(source);
    textState.set(node, { source: source, last: result });
    if (current !== result) node.nodeValue = result;
  }

  function sourceForAttribute(el, name, current) {
    var states = attributeState.get(el) || Object.create(null);
    var state = states[name];
    if (state && current === state.last) return state.source;
    return reverse[key(current)] || current;
  }

  function translateAttributes(el) {
    if (!el || !el.getAttribute || skipContentTags[el.tagName] || el.isContentEditable || el.closest('[data-no-translate]')) return;
    var states = attributeState.get(el) || Object.create(null);
    attributeNames.forEach(function (name) {
      if (!el.hasAttribute(name)) return;
      var current = el.getAttribute(name);
      var source = sourceForAttribute(el, name, current);
      var result = translate(source);
      states[name] = { source: source, last: result };
      if (current !== result) el.setAttribute(name, result);
    });
    attributeState.set(el, states);
  }

  function scan(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      if (skipContentTags[root.tagName] || root.isContentEditable || (root.closest && root.closest('[data-no-translate]'))) return;
      translateAttributes(root);
      if (noTranslateTextTags[root.tagName]) return;
    }
    var children = root.childNodes;
    for (var i = 0; i < children.length; i++) scan(children[i]);
  }

  function translateNotificationMessage(row) {
    if (!row || window.MM_HOME_LANGUAGE !== 'mr') return String(row && row.message || '');
    var type = String(row.notification_type || '').toUpperCase();
    var source = clean(row.message || '');
    var match;
    if (type === 'CASH_AT_COUNTER') {
      match = source.match(/^CASH AT COUNTER\s*·\s*Table\s+(\d+)\s*·\s*Assigned waiter\s+([^·]+)\s*·\s*Guest is leaving now and says they will pay cash at the counter\s*·\s*Visit\s+([A-Za-z0-9-]+)\s*·\s*Balance\s*₹([\d,]+(?:\.\d{1,2})?)$/i);
      if (match) return 'काउंटरवर रोख पैसे · टेबल ' + match[1] + ' · नेमलेला वेटर ' + (match[2].toLowerCase() === 'not assigned' ? 'नेमलेला नाही' : match[2]) + ' · ग्राहक काउंटरवर रोख पैसे देणार आहे · भेट ' + match[3] + ' · बाकी ₹' + match[4];
      match = source.match(/^CASH AT COUNTER\s*·\s*Table\s+(\d+)\s*·\s*Guest is leaving now and says they will pay cash at the counter\s*·\s*Visit\s+([A-Za-z0-9-]+)\s*·\s*Balance\s*₹([\d,]+(?:\.\d{1,2})?)$/i);
      if (match) return 'काउंटरवर रोख पैसे · टेबल ' + match[1] + ' · ग्राहक काउंटरवर रोख पैसे देणार आहे · भेट ' + match[2] + ' · बाकी ₹' + match[3];
    }
    if (type === 'GUEST_LEFT_UNPAID') {
      match = source.match(/^GUEST LEFT UNPAID\s*·\s*Table\s+(\d+)\s*·\s*Assigned waiter\s+([^·]+)\s*·\s*Balance\s*₹([\d,]+(?:\.\d{1,2})?)\s*·\s*Reason:\s*(.*?)\s*·\s*Visit\s+([A-Za-z0-9-]+)$/i);
      if (match) return 'ग्राहक बिल न भरता निघून गेला · टेबल ' + match[1] + ' · वेटर ' + (match[2].toLowerCase() === 'not assigned' ? 'नेमलेला नाही' : match[2]) + ' · बाकी ₹' + match[3] + ' · कारण: ' + match[4] + ' · भेट ' + match[5];
    }
    if (type === 'PAYMENT_CHECK') {
      match = source.match(/^Payment verification requested\s*·\s*Table\s+(\d+)\s*·\s*Assigned waiter\s+([^·]+)\s*·\s*Visit\s+([A-Za-z0-9-]+)\s*·\s*Customer reports paying via\s+([^·]+)\s*·\s*Balance\s*₹([\d,]+(?:\.\d{1,2})?)\.?\s*Verify the restaurant transaction before recording payment\.?$/i);
      if (match) return 'पेमेंट तपासण्याची विनंती · टेबल ' + match[1] + ' · वेटर ' + (match[2].toLowerCase() === 'not assigned' ? 'नेमलेला नाही' : match[2]) + ' · भेट ' + match[3] + ' · ग्राहकाने ' + match[4] + ' द्वारे पैसे भरल्याचे सांगितले · बाकी ₹' + match[5] + ' · नोंद करण्यापूर्वी व्यवहार तपासा';
      match = source.match(/^Payment verification requested\s*·\s*Table\s+(\d+)\s*·\s*Customer reports paying via\s+(.+?)\.\s*Please verify the transaction in the restaurant account before recording payment\.?$/i);
      if (match) return 'पेमेंट तपासण्याची विनंती · टेबल ' + match[1] + ' · ग्राहकाने ' + match[2] + ' द्वारे पैसे भरल्याचे सांगितले · पेमेंट नोंदवण्यापूर्वी रेस्टॉरंट खात्यात व्यवहार तपासा';
    }
    if (type === 'PARTY_BOOKING') {
      match = source.match(/^New party request\s+(PARTY-[A-Z0-9-]+)\s*[—-]\s*(.+?);\s*(\d+) guests;\s*(.+?) at (.+?)\. Please review Party Bookings\.?$/i);
      if (match) return 'नवीन कार्यक्रम बुकिंग ' + match[1] + ' · ' + match[2] + ' · ' + match[3] + ' पाहुणे · ' + match[4] + ' रोजी ' + match[5] + ' · कृपया कार्यक्रम बुकिंग तपासा';
    }
    if (type === 'ORDER_APPROVAL') {
      match = source.match(/^(?:Customer order waiting for owner approval|Customer order waiting for owner approval)\s*·\s*Table\s+(\d+)$/i);
      if (match) return 'ग्राहकाची ऑर्डर मालकांच्या मंजुरीसाठी प्रतीक्षेत आहे · टेबल ' + match[1];
    }
    return translatedSourceText(source) || source;
  }

  window.MM_TRANSLATE_NOTIFICATION_MESSAGE = translateNotificationMessage;

  function languageLabel() {
    return window.MM_HOME_LANGUAGE === 'mr' ? 'English' : 'मराठी';
  }

  function ensureGlobalToggle() {
    var button = document.getElementById('app-global-language-toggle');
    if (!button && document.body) {
      button = document.createElement('button');
      button.id = 'app-global-language-toggle';
      button.type = 'button';
      button.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top,0px) + 9px);right:10px;z-index:79;min-height:34px;padding:6px 11px;border:1px solid var(--gold,#d4a84b);border-radius:999px;background:var(--surface,#211812);color:var(--gold2,#f0d78c);font-size:12px;font-weight:800;box-shadow:0 4px 14px rgba(0,0,0,.22);cursor:pointer;display:none';
      button.addEventListener('click', function () {
        if (typeof window.toggleHomeLanguage === 'function') window.toggleHomeLanguage();
      });
      document.body.appendChild(button);
    }
    if (!button) return;
    button.textContent = languageLabel();
    button.title = window.MM_HOME_LANGUAGE === 'mr' ? 'Switch language to English' : 'भाषा मराठीत बदला';
    button.setAttribute('aria-label', button.title);
    var active = document.querySelector('.screen.on');
    var hasExistingToggle = !!(active && active.querySelector('#home-language-toggle, #waiter-language-toggle'));
    var overlayOpen = !!document.querySelector('.drawer.on, .modal.on, .modal.show, .qr-modal.on');
    button.style.display = hasExistingToggle && !overlayOpen ? 'none' : 'inline-flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
  }

  function applyLanguageSideEffects() {
    document.documentElement.lang = window.MM_HOME_LANGUAGE === 'mr' ? 'mr' : 'en';
    scan(document.body);
    ensureGlobalToggle();
    if (typeof window.MM_UPDATE_STAFF_PUSH_LANGUAGE === 'function') {
      try {
        var result = window.MM_UPDATE_STAFF_PUSH_LANGUAGE(window.MM_HOME_LANGUAGE);
        if (result && typeof result.catch === 'function') result.catch(function (error) {
          console.info('[Mirch Masaala language] Push preference will sync when alerts are next enabled.', error && error.message ? error.message : error);
        });
      } catch (error) {}
    }
  }

  var originalI18n = typeof window.mmI18n === 'function' ? window.mmI18n : function (english) { return english; };
  window.mmI18n = function (english, marathi) {
    if (typeof english === 'string' && typeof marathi === 'string' && marathi) {
      if (!forward[key(english)]) forward[key(english)] = marathi;
      if (!reverse[key(marathi)]) reverse[key(marathi)] = english;
    }
    if (window.MM_HOME_LANGUAGE !== 'mr') return String(english == null ? '' : english);
    if (typeof marathi === 'string' && marathi) return marathi;
    var local = translatedSourceText(english);
    if (local) return local;
    var fromOriginal = originalI18n(english, marathi);
    return fromOriginal || String(english == null ? '' : english);
  };
  window.mmFriendlyError = function (error, operation) {
    var raw = typeof error === 'string' ? error : String((error && error.message) || '');
    var extra = error && typeof error === 'object'
      ? [error.code, error.details, error.hint].filter(Boolean).join(' ')
      : '';
    var combined = (raw + ' ' + extra).toLowerCase();
    var english = raw || 'An unexpected error occurred. Please ask your waiter for help.';
    if (/pgrst202|42883|schema cache|could not find the function|function public\.mm_place_order|mm_place_order.*(not found|does not exist)|secure table ordering is not activated|run .*sql|sql.*function/i.test(combined)) {
      english = 'Order setup needs an update. Please tell the owner to apply the required QR-order SQL migration, then try again.';
    } else if (/mm_ensure_public_table_visit|table is not open for ordering|active table visit|visit is not active|not open for ordering|this table is not active|start the visit|start this table|table visit has changed/i.test(combined)) {
      english = 'This table has not been started by a waiter yet. Please ask your waiter to start the table, then try again.';
    } else if (/menu item.*(unavailable|not found)|price.*changed|menu.*changed|not available anymore/i.test(combined)) {
      english = 'The menu changed while you were ordering. Please refresh the menu before trying again.';
    } else if (/failed to fetch|networkerror|network request failed|load failed|offline/i.test(combined)) {
      english = 'The network connection failed. Please check your internet and try again.';
    } else if (/order.*(timeout|timed out)|gateway timeout/i.test(combined)) {
      english = 'The order could not be confirmed. Please check My orders before retrying.';
    }
    if (window.MM_HOME_LANGUAGE === 'mr') return translatedSourceText(english) || english;
    return english;
  };

  var originalApplyLanguage = typeof window.applyHomeLanguage === 'function' ? window.applyHomeLanguage : null;
  if (originalApplyLanguage) {
    window.applyHomeLanguage = function (language) {
      var result = originalApplyLanguage.apply(this, arguments);
      applyLanguageSideEffects();
      return result;
    };
  }

  function installObserver() {
    if (!document.body) return;
    scan(document.body);
    ensureGlobalToggle();
    if (!window.MutationObserver) return;
    var observer = new MutationObserver(function (records) {
      records.forEach(function (record) {
        if (record.type === 'childList') {
          record.addedNodes.forEach(function (node) { scan(node); });
        } else if (record.type === 'characterData') {
          translateTextNode(record.target);
        } else if (record.type === 'attributes') {
          if (record.attributeName === 'class') ensureGlobalToggle();
          else translateAttributes(record.target);
        }
      });
    });
    observer.observe(document.body, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label', 'alt', 'class']
    });
    applyLanguageSideEffects();
  }

  window.MM_TRANSLATE_TEXT = translate;
  window.MM_TRANSLATION_DICTIONARY = dictionary;
  if (document.body) installObserver();
  else document.addEventListener('DOMContentLoaded', installObserver, { once: true });
})();